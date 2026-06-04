import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tasks, runs, agents } from "../db/schema.js";
import { canTransition, isTerminal, type RunState } from "./runs.js";

export interface OpenTaskInput {
  orgId: string;
  threadId: string;
  intent: string;
  agentId: string;
  createdByKind: "human" | "agent";
  createdById: string;
}

export async function openTaskForMention(db: DB, i: OpenTaskInput) {
  const taskId = randomUUID();
  const runId = randomUUID();
  const [task] = await db.insert(tasks).values({
    id: taskId, orgId: i.orgId, threadId: i.threadId, title: i.intent,
    state: "in_progress", assigneeKind: "agent", assigneeId: i.agentId,
    createdByKind: i.createdByKind, createdById: i.createdById,
  }).returning();
  const [run] = await db.insert(runs).values({
    id: runId, orgId: i.orgId, taskId, state: "pending", workflowId: `run-${runId}`,
  }).returning();
  return { task, run };
}

export interface ReassignInput {
  orgId: string;
  taskId: string;
  agentId: string;
  byKind: "human" | "agent";
  byId: string;
}

// Hand a task to another agent: re-point the assignee and spin a fresh pending Run
// for the new owner. Both task and agent are loaded org-scoped (#14 pattern) so a
// cross-org task id or agent id can never be reassigned/leaked.
export async function reassignTask(db: DB, i: ReassignInput) {
  const [existing] = await db.select().from(tasks)
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)));
  if (!existing) throw new Error(`task not found: ${i.taskId}`);

  const [agent] = await db.select().from(agents)
    .where(and(eq(agents.id, i.agentId), eq(agents.orgId, i.orgId)));
  if (!agent) throw new Error(`agent not found: ${i.agentId}`);

  const [task] = await db.update(tasks)
    .set({ assigneeKind: "agent", assigneeId: i.agentId, state: "in_progress" })
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)))
    .returning();

  const runId = randomUUID();
  const [run] = await db.insert(runs).values({
    id: runId, orgId: i.orgId, taskId: i.taskId, state: "pending", workflowId: `run-${runId}`,
  }).returning();

  return { task, run, agent };
}

export interface RunFields {
  branch?: string; commitSha?: string; prNumber?: number; prUrl?: string;
}

export async function transitionRun(db: DB, runId: string, to: RunState, fields: RunFields, orgId: string) {
  const [current] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
  if (!current) throw new Error(`run not found: ${runId}`);
  if (current.state !== to && !canTransition(current.state as RunState, to)) {
    throw new Error(`illegal transition ${current.state} -> ${to}`);
  }
  const [run] = await db.update(runs).set({ state: to, ...fields })
    .where(and(eq(runs.id, runId), eq(runs.orgId, orgId))).returning();
  if (isTerminal(to)) {
    const taskState = to === "merged" ? "done" : "blocked";
    await db.update(tasks).set({ state: taskState })
      .where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, orgId)));
  }
  return run;
}
