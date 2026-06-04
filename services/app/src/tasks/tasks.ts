import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { tasks, runs, agents, taskComments, taskRelations } from "../db/schema.js";
import { canTransition, isTerminal, type RunState } from "./runs.js";
import type { StartRepo } from "../fusion/start.js";

// #81 richer tasks: the valid priority levels + the richer status set. `open` is
// kept as a valid state value for backward-compat with existing tasks/runs that
// default to it. Bulk create is capped at 50 items per call.
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATES = [
  "open", // backward-compat alias (existing default)
  "backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_RELATIONS = ["blocks", "related", "duplicate"] as const;
export type TaskRelationKind = (typeof TASK_RELATIONS)[number];

export const BULK_CREATE_MAX = 50;

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
  // #53 stacked PRs: when set, the new hand-off run records this parent run so its
  // PR can base on the parent's branch. Default null → flat (today's behavior).
  parentRunId?: string;
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
    parentRunId: i.parentRunId ?? null,
  }).returning();

  return { task, run, agent };
}

// The fusion starter, narrowed to what fanOutTask needs. Injectable so tests can
// pass a fake (no live Temporal/GitHub required — mirrors the reassign route guard).
export type FusionStarter = (input: {
  run: { id: string; workflowId: string };
  orgId: string;
  threadId: string;
  repo: StartRepo;
  agentId: string;
  intent: string;
  sandboxUrl: string;
}) => Promise<void>;

export interface FanOutInput {
  orgId: string;
  taskId: string;
  agentIds: string[];
  threadId: string;
  // The resolved repo + sandbox to start each run on. When absent (no repo/token),
  // the runs are still recorded and `start` is simply skipped (like reassign).
  repo?: StartRepo | null;
  sandboxUrl: string;
  // Injected starter (real `startFusionRun` bound to a temporal client, or a fake
  // in tests). When null, run rows are created but no workflow is started.
  start?: FusionStarter | null;
}

// #64 fan-out: spin up N concurrent Runs for ONE task, one per agent (competing
// approaches). Each agent is loaded org-scoped (#14) so a cross-org/unknown agent
// id is silently skipped — never leaked or started. agentIds are de-duplicated so
// the same agent can't be fanned out to twice. Each run gets its own pending row +
// `agent/<runId>` branch via the injected starter (guarded: no repo/token → skip).
// Returns the created run ids (in input order, after dedup + skip).
export async function fanOutTask(db: DB, i: FanOutInput) {
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)));
  if (!task) throw new Error(`task not found: ${i.taskId}`);

  const seen = new Set<string>();
  const created: Array<{ runId: string; agentId: string }> = [];
  for (const agentId of i.agentIds) {
    if (seen.has(agentId)) continue;
    seen.add(agentId);

    const [agent] = await db.select().from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.orgId, i.orgId)));
    if (!agent) continue; // unknown/cross-org agent → skipped

    const runId = randomUUID();
    await db.insert(runs).values({
      id: runId, orgId: i.orgId, taskId: i.taskId, state: "pending", workflowId: `run-${runId}`,
    });

    if (i.start && i.repo) {
      await i.start({
        run: { id: runId, workflowId: `run-${runId}` },
        orgId: i.orgId, threadId: i.threadId, repo: i.repo, agentId,
        intent: task.title, sandboxUrl: i.sandboxUrl,
      });
    }
    created.push({ runId, agentId });
  }
  return { task, runIds: created.map((c) => c.runId), created };
}

// #64 select-winner: mark ONE run the exclusive winner among its task's siblings.
// Org-scoped (#14): a cross-org/unknown run id → throws (route maps to 404). The
// clear-siblings + set-winner happen in a single transaction so the "exactly one
// selected per task" invariant never observes an intermediate state. Idempotent:
// selecting an already-selected run still leaves it the sole winner.
export async function selectRun(db: DB, orgId: string, runId: string) {
  const [run] = await db.select().from(runs)
    .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)));
  if (!run) throw new Error(`run not found: ${runId}`);

  const updated = await db.transaction(async (tx) => {
    // Clear every sibling (same task + org), then set this run — exclusive winner.
    await tx.update(runs).set({ selected: false })
      .where(and(eq(runs.taskId, run.taskId), eq(runs.orgId, orgId)));
    const [winner] = await tx.update(runs).set({ selected: true })
      .where(and(eq(runs.id, runId), eq(runs.orgId, orgId)))
      .returning();
    return winner;
  });
  return updated;
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

// ── #81 richer tasks ────────────────────────────────────────────────────────

export interface UpdateTaskInput {
  orgId: string;
  taskId: string;
  priority?: TaskPriority;
  dueDate?: Date | string | null;
  state?: TaskState;
}

// Partial-update a task's priority / due date / status, org-scoped (#14). A
// cross-org/unknown task id throws (route → 404). priority and state are validated
// against TASK_PRIORITIES / TASK_STATES — an invalid value throws (route → 400).
// Only the provided fields are written; an undefined field is left untouched (a
// `dueDate: null` explicitly clears the due date).
export async function updateTask(db: DB, i: UpdateTaskInput) {
  if (i.priority !== undefined && !TASK_PRIORITIES.includes(i.priority)) {
    throw new Error(`invalid priority: ${i.priority}`);
  }
  if (i.state !== undefined && !TASK_STATES.includes(i.state)) {
    throw new Error(`invalid state: ${i.state}`);
  }

  const [existing] = await db.select().from(tasks)
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)));
  if (!existing) throw new Error(`task not found: ${i.taskId}`);

  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (i.priority !== undefined) patch.priority = i.priority;
  if (i.state !== undefined) patch.state = i.state;
  if (i.dueDate !== undefined) {
    patch.dueDate = i.dueDate === null ? null : new Date(i.dueDate);
  }

  // Nothing to change → return the current row (still org-scoped, no-op).
  if (Object.keys(patch).length === 0) return existing;

  const [task] = await db.update(tasks).set(patch)
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)))
    .returning();
  return task;
}

export interface AddTaskCommentInput {
  orgId: string;
  taskId: string;
  authorKind: "human" | "agent";
  authorId: string;
  body: string;
}

// Add a comment to a task. The task must exist in the org (#14) — a cross-org/unknown
// task id throws (route → 404). Returns the created comment row.
export async function addTaskComment(db: DB, i: AddTaskCommentInput) {
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, i.taskId), eq(tasks.orgId, i.orgId)));
  if (!task) throw new Error(`task not found: ${i.taskId}`);

  const [comment] = await db.insert(taskComments).values({
    id: randomUUID(), orgId: i.orgId, taskId: i.taskId,
    authorKind: i.authorKind, authorId: i.authorId, body: i.body,
  }).returning();
  return comment;
}

// List a task's comments (org-scoped), oldest first.
export async function listTaskComments(db: DB, orgId: string, taskId: string) {
  return db.select().from(taskComments)
    .where(and(eq(taskComments.orgId, orgId), eq(taskComments.taskId, taskId)))
    .orderBy(taskComments.createdAt);
}

export interface AddTaskRelationInput {
  orgId: string;
  fromTaskId: string;
  toTaskId: string;
  relation: TaskRelationKind;
}

// Link two org tasks (blocks|related|duplicate). Both tasks must exist in the org
// (#14) — a cross-org/unknown id throws (route → 404). Idempotent via the unique
// (orgId,fromTaskId,toTaskId,relation) index: re-adding the same link returns the
// existing row instead of erroring.
export async function addTaskRelation(db: DB, i: AddTaskRelationInput) {
  if (!TASK_RELATIONS.includes(i.relation)) {
    throw new Error(`invalid relation: ${i.relation}`);
  }
  for (const tid of [i.fromTaskId, i.toTaskId]) {
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.id, tid), eq(tasks.orgId, i.orgId)));
    if (!task) throw new Error(`task not found: ${tid}`);
  }

  const [relation] = await db.insert(taskRelations).values({
    id: randomUUID(), orgId: i.orgId,
    fromTaskId: i.fromTaskId, toTaskId: i.toTaskId, relation: i.relation,
  }).onConflictDoNothing({
    target: [taskRelations.orgId, taskRelations.fromTaskId, taskRelations.toTaskId, taskRelations.relation],
  }).returning();

  // Conflict (idempotent re-add) → no row returned; fetch the existing one.
  if (relation) return relation;
  const [existing] = await db.select().from(taskRelations)
    .where(and(
      eq(taskRelations.orgId, i.orgId),
      eq(taskRelations.fromTaskId, i.fromTaskId),
      eq(taskRelations.toTaskId, i.toTaskId),
      eq(taskRelations.relation, i.relation),
    ));
  return existing;
}

// List relations where the task is either the `from` or the `to` end (org-scoped).
export async function listTaskRelations(db: DB, orgId: string, taskId: string) {
  return db.select().from(taskRelations)
    .where(and(
      eq(taskRelations.orgId, orgId),
      or(eq(taskRelations.fromTaskId, taskId), eq(taskRelations.toTaskId, taskId)),
    ))
    .orderBy(taskRelations.createdAt);
}

export interface BulkCreateItem {
  title: string;
  priority?: TaskPriority;
  dueDate?: Date | string | null;
  state?: TaskState;
}

export interface BulkCreateInput {
  orgId: string;
  threadId: string;
  items: BulkCreateItem[];
  byKind: "human" | "agent";
  byId: string;
}

// Create up to BULK_CREATE_MAX (50) tasks in one transaction. Over the cap → throws
// (route → 400). Each item's priority/state is validated; new tasks default to
// state "backlog" and priority "none" unless the item overrides. Returns created ids.
export async function bulkCreateTasks(db: DB, i: BulkCreateInput) {
  if (i.items.length > BULK_CREATE_MAX) {
    throw new Error(`too many items: ${i.items.length} (max ${BULK_CREATE_MAX})`);
  }
  for (const it of i.items) {
    if (it.priority !== undefined && !TASK_PRIORITIES.includes(it.priority)) {
      throw new Error(`invalid priority: ${it.priority}`);
    }
    if (it.state !== undefined && !TASK_STATES.includes(it.state)) {
      throw new Error(`invalid state: ${it.state}`);
    }
  }

  const rows = i.items.map((it) => ({
    id: randomUUID(), orgId: i.orgId, threadId: i.threadId, title: it.title,
    state: it.state ?? "backlog",
    priority: it.priority ?? "none",
    dueDate: it.dueDate == null ? null : new Date(it.dueDate),
    createdByKind: i.byKind, createdById: i.byId,
  }));

  if (rows.length === 0) return { ids: [] as string[] };

  const created = await db.transaction(async (tx) => {
    return tx.insert(tasks).values(rows).returning({ id: tasks.id });
  });
  return { ids: created.map((c) => c.id) };
}
