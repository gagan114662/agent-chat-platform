import { and, eq, inArray } from "drizzle-orm";
import type { Client } from "@temporalio/client";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { tasks, threads, repos, runs, agents } from "../db/schema.js";
import { startFusionRun, type StartFusionRunInput } from "../fusion/start.js";
import { agentModelConfig } from "../agents/agents.js";

// `start` is injectable so the tick can run with a FAKE temporal in tests (and so the
// production path stays identical to the mention/hand-off starter). It defaults to the
// real `startFusionRun`, which talks to the injected Temporal `Client`.
export type StartRun = (temporal: Client, input: StartFusionRunInput) => Promise<void>;

export interface TickDeps {
  db: DB;
  sql: postgres.Sql;
  temporal: Client;
  sandboxUrl: string;
  start?: StartRun;
}
export interface TickResult { dispatched: string[]; skipped: number; reason: string; }

// One self-prompting iteration for an org: find OPEN tasks that are ready to run
// (assigned to an agent, thread has a repo with a resolvable token, NOT monitor-only,
// and no active run yet) and dispatch fusion runs for them — bounded by budgetMax.
// Observe → decide → act. The merge/risk/approval gates still apply downstream.
export async function tick(d: TickDeps, args: { orgId: string; budgetMax?: number }): Promise<TickResult> {
  const budget = args.budgetMax ?? 5;
  const start = d.start ?? ((t, i) => startFusionRun(t, i));
  const open = await d.db.select().from(tasks).where(and(eq(tasks.orgId, args.orgId), eq(tasks.state, "open")));
  const dispatched: string[] = [];
  let skipped = 0;
  for (const t of open) {
    if (dispatched.length >= budget) { skipped++; continue; }
    if (t.assigneeKind !== "agent" || !t.assigneeId) { skipped++; continue; }
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, t.threadId), eq(threads.orgId, args.orgId)));
    if (!thread?.repoId) { skipped++; continue; }
    const [repo] = await d.db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, args.orgId)));
    if (!repo) { skipped++; continue; }
    if ((repo.autonomy as string) === "monitor-only") { skipped++; continue; } // human-driven dial
    if (!process.env[repo.tokenEnvVar]) { skipped++; continue; }
    // no active (pending/running/awaiting_plan_approval) run for this task already
    const existing = await d.db.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.orgId, args.orgId), eq(runs.taskId, t.id), inArray(runs.state, ["pending", "running", "awaiting_plan_approval"])));
    if (existing.length > 0) { skipped++; continue; }
    // ACT: open a run for the task + start fusion. Reuse the task→run + starter.
    const runId = `run-${t.id}-${dispatched.length}`;
    // #58: resolve the assignee agent so its config.model/provider threads through.
    const [agent] = await d.db.select().from(agents)
      .where(and(eq(agents.id, t.assigneeId), eq(agents.orgId, args.orgId)));
    await d.db.insert(runs).values({ id: runId, orgId: args.orgId, taskId: t.id, state: "pending", workflowId: `wf-${runId}` });
    await d.db.update(tasks).set({ state: "in_progress" }).where(and(eq(tasks.id, t.id), eq(tasks.orgId, args.orgId)));
    await start(d.temporal, {
      run: { id: runId, workflowId: `wf-${runId}` }, orgId: args.orgId, threadId: t.threadId,
      repo: {
        githubOwner: repo.githubOwner, githubName: repo.githubName,
        defaultBranch: repo.defaultBranch, tokenEnvVar: repo.tokenEnvVar, autonomy: repo.autonomy,
      },
      agentId: t.assigneeId, intent: t.title, sandboxUrl: d.sandboxUrl,
      ...agentModelConfig(agent), // #58: per-agent model/provider from agents.config
    });
    dispatched.push(runId);
  }
  return { dispatched, skipped, reason: `budget ${budget}, ${open.length} open tasks` };
}
