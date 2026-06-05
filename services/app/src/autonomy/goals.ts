import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { goals, tasks } from "../db/schema.js";

export interface NewGoal { orgId: string; title: string; criteria?: string; byKind: string; byId: string; }
export async function createGoal(db: DB, g: NewGoal) {
  const [row] = await db.insert(goals).values({
    id: randomUUID(), orgId: g.orgId, title: g.title, criteria: g.criteria ?? "", state: "open",
    createdByKind: g.byKind, createdById: g.byId,
  }).returning();
  return row;
}

export interface Subtask { title: string; }
export type GoalPlanner = (goal: { title: string; criteria: string }) => Subtask[];
// Deterministic default: one task per non-empty line of criteria, else the title.
export const defaultGoalPlanner: GoalPlanner = (goal) => {
  const lines = goal.criteria.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter(Boolean);
  return (lines.length ? lines : [goal.title]).map((title) => ({ title }));
};

// decomposeGoal: turn an open goal into Tasks (org-scoped), mark it active. Idempotent:
// a goal already 'active'/'done' is skipped. Returns the created task ids.
// #120: tasks are ASSIGNED to an agent when `assigneeId` is given — otherwise the
// autonomy tick can never dispatch them (it only runs agent-assigned tasks).
export async function decomposeGoal(
  db: DB, args: { orgId: string; goalId: string; threadId: string; assigneeId?: string; planner?: GoalPlanner },
): Promise<string[]> {
  const [g] = await db.select().from(goals).where(and(eq(goals.id, args.goalId), eq(goals.orgId, args.orgId)));
  if (!g || g.state !== "open") return [];
  const subs = (args.planner ?? defaultGoalPlanner)({ title: g.title, criteria: g.criteria });
  const ids: string[] = [];
  for (const s of subs) {
    // reuse the task creator (a task needs a thread; the goal carries one)
    const [t] = await db.insert(tasks).values({
      id: randomUUID(), orgId: args.orgId, threadId: args.threadId, title: s.title,
      state: "open", createdByKind: "agent", createdById: "planner",
      ...(args.assigneeId ? { assigneeKind: "agent", assigneeId: args.assigneeId } : {}),
    }).returning({ id: tasks.id });
    ids.push(t.id);
  }
  await db.update(goals).set({ state: "active" }).where(and(eq(goals.id, g.id), eq(goals.orgId, args.orgId)));
  return ids;
}

// listGoals: the org's goals (newest-ish; small table). Powers the Goals panel so
// goals persist across navigation instead of living only in component state (#120).
export async function listGoals(db: DB, orgId: string) {
  return db.select().from(goals).where(eq(goals.orgId, orgId));
}
