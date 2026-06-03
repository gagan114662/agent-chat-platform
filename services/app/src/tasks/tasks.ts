import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tasks, runs } from "../db/schema.js";
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

export interface RunFields {
  branch?: string; commitSha?: string; prNumber?: number; prUrl?: string;
}

export async function transitionRun(db: DB, runId: string, to: RunState, fields: RunFields) {
  const [current] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!current) throw new Error(`run not found: ${runId}`);
  if (current.state !== to && !canTransition(current.state as RunState, to)) {
    throw new Error(`illegal transition ${current.state} -> ${to}`);
  }
  const [run] = await db.update(runs).set({ state: to, ...fields }).where(eq(runs.id, runId)).returning();
  if (isTerminal(to)) {
    const taskState = to === "merged" ? "done" : "blocked";
    await db.update(tasks).set({ state: taskState }).where(eq(tasks.id, run.taskId));
  }
  return run;
}
