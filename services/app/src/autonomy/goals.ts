import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { goals, tasks, agents } from "../db/schema.js";
import { listReputations } from "../delegation/reputation-store.js";
import { recordLink } from "../delegation/chain-store.js";

// #127 capability/reputation auto-assignment: with no explicit assignee, route the
// goal's tasks to the most-trusted eligible agent (highest live reputation; new
// agents sit at the 50% prior). Returns undefined when the org has no agents.
async function bestAgentId(db: DB, orgId: string): Promise<string | undefined> {
  const orgAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.orgId, orgId));
  if (orgAgents.length === 0) return undefined;
  const reps = await listReputations(db, orgId);
  return orgAgents
    .map((a) => ({ id: a.id, score: reps[a.id]?.scorePct ?? 50 }))
    .sort((x, y) => y.score - x.score)[0].id;
}

export interface NewGoal { orgId: string; title: string; criteria?: string; byKind: string; byId: string; businessId?: string; }
export async function createGoal(db: DB, g: NewGoal) {
  const [row] = await db.insert(goals).values({
    id: randomUUID(), orgId: g.orgId, title: g.title, criteria: g.criteria ?? "", state: "open",
    createdByKind: g.byKind, createdById: g.byId,
    businessId: g.businessId ?? null, // #146: a business goal advances the funnel, not a repo
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
  // #127: explicit assignee wins; otherwise auto-route to the best agent by reputation.
  const assigneeId = args.assigneeId ?? (await bestAgentId(db, args.orgId));
  const ids: string[] = [];
  for (const s of subs) {
    // reuse the task creator (a task needs a thread; the goal carries one)
    const [t] = await db.insert(tasks).values({
      id: randomUUID(), orgId: args.orgId, threadId: args.threadId, title: s.title,
      state: "open", createdByKind: "agent", createdById: "planner",
      goalId: args.goalId, // #137/#138: link the task to its goal for the autonomous loop
      ...(assigneeId ? { assigneeKind: "agent", assigneeId } : {}),
    }).returning({ id: tasks.id });
    ids.push(t.id);
    // #130: record the hand-off (goal's human creator → the assignee agent) so the
    // task's delegation chain traces back to the accountable human.
    if (assigneeId) {
      await recordLink(db, {
        orgId: args.orgId, taskId: t.id,
        byKind: g.createdByKind === "human" ? "human" : "agent", byId: g.createdById,
        toKind: "agent", toId: assigneeId,
      });
    }
  }
  await db.update(goals).set({ state: "active" }).where(and(eq(goals.id, g.id), eq(goals.orgId, args.orgId)));
  return ids;
}

// listGoals: the org's goals (newest-ish; small table). Powers the Goals panel so
// goals persist across navigation instead of living only in component state (#120).
export async function listGoals(db: DB, orgId: string) {
  return db.select().from(goals).where(eq(goals.orgId, orgId));
}

// #137: flip a goal's self-drive flag. When on, the unattended scheduler advances
// it with no human "Run now". Org-scoped. Returns the updated goal (or undefined).
export async function setGoalAutonomy(db: DB, orgId: string, goalId: string, on: boolean) {
  const [row] = await db.update(goals).set({ autonomy: on })
    .where(and(eq(goals.id, goalId), eq(goals.orgId, orgId))).returning();
  return row;
}

// #137: the org's active, self-driving goals — the set the scheduler may advance.
export async function autonomousGoals(db: DB, orgId: string) {
  return db.select().from(goals)
    .where(and(eq(goals.orgId, orgId), eq(goals.state, "active"), eq(goals.autonomy, true)));
}
