// #98 user automations — schedule + event triggers → message/run actions.
//
// An Automation = a `trigger` (schedule cron OR event) → an `action` (post a
// message OR start an agent run). Schedule automations fire from the #67 tick
// (runDueScheduleAutomations); event automations fire from the fusion sink on an
// outcome (fireEventAutomations). Distinct from #67's internal loop — this exposes
// scheduling/triggers to users. Org-scoped throughout (#14), budget-bounded, and
// the `run` action is guarded (no repo/token → skip) so it can never half-start.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Client } from "@temporalio/client";
import type postgres from "postgres";
import type { DB } from "../db/client.js";
import { automations, threads, repos, agents, runs, tasks } from "../db/schema.js";
import { startFusionRun } from "../fusion/start.js";
import { agentModelConfig, agentMcp } from "../agents/agents.js";
import { createMessage } from "../chat/messages.js";
import { notify } from "../db/client.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import type { StartRun } from "./tick.js";

// A schedule trigger fires when `lastFiredAt` is older than `everyMinutes` (or null).
export interface ScheduleTrigger { type: "schedule"; everyMinutes: number; }
// An event trigger fires when its `event` matches the dispatched event (e.g.
// `outcome:checks_failed`).
export interface EventTrigger { type: "event"; event: string; }
export type Trigger = ScheduleTrigger | EventTrigger;

// A message action posts into a thread (createMessage + notify).
export interface MessageAction { type: "message"; threadId: string; body: string; }
// A run action starts an agent fusion run on the thread's repo (guarded: skipped
// when the thread has no repo or the repo token is unset).
export interface RunAction { type: "run"; threadId: string; agentId: string; intent: string; }
export type Action = MessageAction | RunAction;

// Injectable deps mirror TickDeps: `start` defaults to the real startFusionRun so
// tests inject a FAKE starter and need no live Temporal.
export interface AutomationDeps {
  db: DB;
  sql: postgres.Sql;
  temporal: Client;
  sandboxUrl: string;
  start?: StartRun;
}

// Bound how many schedule automations fire per tick so the loop stays bounded.
const MAX_PER_TICK = 10;

export interface NewAutomation {
  orgId: string;
  name: string;
  trigger: Trigger;
  action: Action;
  createdById: string;
  enabled?: boolean;
}

export async function createAutomation(db: DB, a: NewAutomation) {
  const row = {
    id: randomUUID(),
    orgId: a.orgId,
    name: a.name,
    trigger: a.trigger as unknown as Record<string, unknown>,
    action: a.action as unknown as Record<string, unknown>,
    enabled: a.enabled ?? true,
    createdById: a.createdById,
  };
  const [inserted] = await db.insert(automations).values(row).returning();
  return inserted;
}

export async function listAutomations(db: DB, orgId: string) {
  return db.select().from(automations).where(eq(automations.orgId, orgId));
}

// Org-scoped enable/disable. Returns true when a row in the org was updated.
export async function setEnabled(db: DB, orgId: string, id: string, enabled: boolean): Promise<boolean> {
  const updated = await db.update(automations).set({ enabled })
    .where(and(eq(automations.id, id), eq(automations.orgId, orgId))).returning({ id: automations.id });
  return updated.length > 0;
}

// Org-scoped delete. Returns true when a row in the org was removed.
export async function deleteAutomation(db: DB, orgId: string, id: string): Promise<boolean> {
  const removed = await db.delete(automations)
    .where(and(eq(automations.id, id), eq(automations.orgId, orgId))).returning({ id: automations.id });
  return removed.length > 0;
}

// executeAction — shared dispatch for message/run actions. Returns true when the
// action actually fired (a message was posted, or a run was started). The `run`
// action is guarded: if the thread has no repo, the repo can't be resolved, or its
// token env var is unset, it returns false (skipped) so nothing half-starts.
export async function executeAction(db: DB, deps: AutomationDeps, orgId: string, action: Action): Promise<boolean> {
  if (action.type === "message") {
    const [thread] = await db.select().from(threads).where(and(eq(threads.id, action.threadId), eq(threads.orgId, orgId)));
    if (!thread) return false; // unknown/cross-org thread → skip
    const msg = await createMessage(db, {
      orgId, threadId: action.threadId, authorKind: "agent", authorId: "automation",
      kind: "system", body: action.body,
    });
    await notify(deps.sql, THREAD_CHANNEL, { threadId: action.threadId, message: msg });
    return true;
  }

  // run action — resolve thread → repo + token, then start a fusion run (guarded).
  const start = deps.start ?? ((t, i) => startFusionRun(t, i));
  const [thread] = await db.select().from(threads).where(and(eq(threads.id, action.threadId), eq(threads.orgId, orgId)));
  if (!thread?.repoId) return false; // no repo on the thread → guarded skip
  const [repo] = await db.select().from(repos).where(and(eq(repos.id, thread.repoId), eq(repos.orgId, orgId)));
  if (!repo) return false;
  if (!process.env[repo.tokenEnvVar]) return false; // token unset → guarded skip
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, action.agentId), eq(agents.orgId, orgId)));
  if (!agent) return false; // unknown/cross-org agent → skip

  // Record a Task + pending run (mirrors the tick's ACT path) so the run is tracked.
  const taskId = `auto-task-${randomUUID()}`;
  await db.insert(tasks).values({
    id: taskId, orgId, threadId: action.threadId, title: action.intent, state: "in_progress",
    assigneeKind: "agent", assigneeId: action.agentId, createdByKind: "agent", createdById: "automation",
  });
  const runId = `run-${taskId}`;
  await db.insert(runs).values({ id: runId, orgId, taskId, state: "pending", workflowId: `wf-${runId}` });
  await start(deps.temporal, {
    run: { id: runId, workflowId: `wf-${runId}` }, orgId, threadId: action.threadId,
    repo: {
      githubOwner: repo.githubOwner, githubName: repo.githubName,
      defaultBranch: repo.defaultBranch, tokenEnvVar: repo.tokenEnvVar, autonomy: repo.autonomy,
    },
    agentId: action.agentId, intent: action.intent, sandboxUrl: deps.sandboxUrl,
    ...agentModelConfig(agent),
    ...(agentMcp(agent) ? { mcpServers: agentMcp(agent) } : {}),
  });
  return true;
}

// runDueScheduleAutomations — fire each enabled schedule automation whose
// `lastFiredAt` is older than `everyMinutes` (or null). Bounded by MAX_PER_TICK.
// On a fire, `lastFiredAt` is set to `now` so an immediate re-run is not due.
// Returns the count actually fired. Org-scoped.
export async function runDueScheduleAutomations(
  db: DB,
  deps: AutomationDeps,
  args: { orgId: string; now: Date },
): Promise<number> {
  const rows = await db.select().from(automations)
    .where(and(eq(automations.orgId, args.orgId), eq(automations.enabled, true)));
  let fired = 0;
  for (const row of rows) {
    if (fired >= MAX_PER_TICK) break;
    const trigger = row.trigger as unknown as Trigger;
    if (trigger.type !== "schedule") continue;
    const everyMs = Math.max(0, trigger.everyMinutes) * 60 * 1000;
    const due = !row.lastFiredAt || (args.now.getTime() - new Date(row.lastFiredAt).getTime()) >= everyMs;
    if (!due) continue;
    const ran = await executeAction(db, deps, args.orgId, row.action as unknown as Action);
    if (!ran) continue; // guarded action didn't fire → don't mark fired
    await db.update(automations).set({ lastFiredAt: args.now })
      .where(and(eq(automations.id, row.id), eq(automations.orgId, args.orgId)));
    fired++;
  }
  return fired;
}

// fireEventAutomations — fire each enabled event automation whose `trigger.event`
// matches `event`. Called from the fusion sink on outcomes (best-effort there).
// Returns the count actually fired. Org-scoped.
export async function fireEventAutomations(
  db: DB,
  deps: AutomationDeps,
  args: { orgId: string; event: string },
): Promise<number> {
  const rows = await db.select().from(automations)
    .where(and(eq(automations.orgId, args.orgId), eq(automations.enabled, true)));
  let fired = 0;
  for (const row of rows) {
    if (fired >= MAX_PER_TICK) break;
    const trigger = row.trigger as unknown as Trigger;
    if (trigger.type !== "event" || trigger.event !== args.event) continue;
    const ran = await executeAction(db, deps, args.orgId, row.action as unknown as Action);
    if (ran) fired++;
  }
  return fired;
}
