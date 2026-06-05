import { and, eq, inArray } from "drizzle-orm";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import type { DB } from "../db/client.js";
import { agents, threads, repos, runs } from "../db/schema.js";
import { openTaskForMention } from "../tasks/tasks.js";
import { startFusionRun } from "../fusion/start.js";
import { listReputations } from "../delegation/reputation-store.js";
import { runGraph, type DagNode, type NodeExec, type DagRun } from "./dag.js";

// Wire the DAG (#150.2) to actually RUN: a goal becomes a role-graph
// (Planner → Coder → Reviewer) executed in order, each node dispatching a real
// agent run whose intent carries the prior roles' outputs. The orchestrator (this
// module) holds the context and routes only each node's deps to it — coordinated
// teamwork, not a chaotic bus.

export interface RoleStep extends DagNode { agentHandle?: string }

// defaultRoleGraph: the canonical product workflow for a goal.
export function defaultRoleGraph(goal: string): RoleStep[] {
  return [
    { id: "plan", role: "planner", agentHandle: "hermes", task: `Plan the work for this goal and write the steps:\n${goal}` },
    { id: "code", role: "coder", agentHandle: "coder", deps: ["plan"], task: `Implement the plan for: ${goal}` },
    { id: "review", role: "reviewer", agentHandle: "cursor", deps: ["code"], task: `Review the implementation for: ${goal}. Flag gaps or placeholders.` },
  ];
}

// pickAgentForRole: the named handle if it exists, else the best agent by reputation.
export async function pickAgentForRole(db: DB, orgId: string, handle?: string): Promise<string | undefined> {
  const orgAgents = await db.select({ id: agents.id, handle: agents.handle }).from(agents).where(eq(agents.orgId, orgId));
  if (handle) { const m = orgAgents.find((a) => a.handle === handle); if (m) return m.id; }
  if (orgAgents.length === 0) return undefined;
  const reps = await listReputations(db, orgId);
  return orgAgents.map((a) => ({ id: a.id, score: reps[a.id]?.scorePct ?? 50 })).sort((x, y) => y.score - x.score)[0].id;
}

export interface RoleGraphDeps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }
export interface RoleRunResult { runId: string; outcome: string }

// awaitRunTerminal: poll a run until it reaches a terminal state (or the bound). The
// DAG runs nodes in order, so the next role only starts after this one resolves.
async function awaitRunTerminal(db: DB, orgId: string, runId: string, sleep: (ms: number) => Promise<void>, maxPolls = 40, pollMs = 3000): Promise<string> {
  const terminal = ["merged", "checks_failed", "timeout", "error", "held_for_human", "awaiting_plan_approval"];
  for (let i = 0; i < maxPolls; i++) {
    const [r] = await db.select({ state: runs.state }).from(runs).where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
    if (r && terminal.includes(r.state)) return r.state;
    await sleep(pollMs);
  }
  return "timeout";
}

// makeFusionExec: the production NodeExec — dispatch a fusion run for the node's role
// agent with the node's task (enriched by the prior roles' outcomes), then await it.
export function makeFusionExec(d: RoleGraphDeps, ctx: { orgId: string; threadId: string }, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): NodeExec {
  return async (node, context) => {
    const step = node as RoleStep;
    const agentId = await pickAgentForRole(d.db, ctx.orgId, step.agentHandle);
    if (!agentId) return { runId: "", outcome: "no-agent" } satisfies RoleRunResult;
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, ctx.threadId), eq(threads.orgId, ctx.orgId)));
    if (!thread?.repoId) return { runId: "", outcome: "no-repo" } satisfies RoleRunResult;
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, ctx.orgId)));
    if (!repo || !process.env[repo.tokenEnvVar]) return { runId: "", outcome: "no-repo-token" } satisfies RoleRunResult;
    // pass the prior roles' outcomes as context (minimal, only this node's deps).
    const prior = Object.entries(context).map(([k, v]) => `- ${k}: ${(v as RoleRunResult)?.outcome ?? v}`).join("\n");
    const intent = prior ? `${step.task}\n\n## Prior steps\n${prior}` : step.task;
    const { run } = await openTaskForMention(d.db, { orgId: ctx.orgId, threadId: ctx.threadId, intent, agentId, createdByKind: "agent", createdById: "orchestrator" });
    await startFusionRun(d.temporal, { run, orgId: ctx.orgId, threadId: ctx.threadId, repo, agentId, intent, sandboxUrl: d.sandboxUrl, adapter: undefined });
    const outcome = await awaitRunTerminal(d.db, ctx.orgId, run.id, sleep);
    return { runId: run.id, outcome } satisfies RoleRunResult;
  };
}

// runRoleGraph: execute a role-graph as a coordinated team. exec is injectable
// (tests pass a fake; production uses makeFusionExec).
export async function runRoleGraph(graph: RoleStep[], exec: NodeExec): Promise<DagRun> {
  return runGraph(graph, exec);
}
