import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { goals, tasks } from "../db/schema.js";

// #138 closed-loop goal completion. After tasks run, judge the goal against its
// criteria and either close it or generate the next concrete tasks toward the gap
// — without a human authoring each step.
//
// A goal is decomposed (#120) into one task per criteria line. A task is SATISFIED
// when it reaches "done" (set at the run-outcome boundary on a merged PR — the
// verifiable-completion signal, #126); a FAILED run escalates its task to "blocked"
// (#129). So the goal's state is a pure function of its tasks' states.

export const MAX_ITERATIONS = 3; // bounded self-generation; then stop for a human (#110/#125 gate)

export type GoalOutcome =
  | { status: "skip"; reason: string }
  | { status: "working"; active: number }
  | { status: "done" }
  | { status: "stuck"; blocked: number } // hit the iteration cap → human gate
  | { status: "generated"; taskIds: string[] };

// A next-step generator turns the unmet (blocked) tasks into the next tasks to try.
// Default = retry each unmet task once (same thread + assignee). Injectable so an
// LLM can author smarter next steps from the gap to the criteria.
export interface NextTask { title: string; threadId: string; assigneeKind: string | null; assigneeId: string | null; }
export type NextStepGen = (goal: { title: string; criteria: string }, unmet: NextTask[]) => NextTask[];
export const retryUnmet: NextStepGen = (_goal, unmet) =>
  unmet.map((t) => ({ ...t, title: t.title.startsWith("retry: ") ? t.title : `retry: ${t.title}` }));

const ACTIVE = ["open", "in_progress"];
// #140: a criterion about being live at a public URL is met by a successful deploy.
const LIVE_URL_RE = /\b(live|deploy(ed)?|public url|reachable)\b/i;

// progressGoal: one closed-loop step for a single active goal. Pure decision over
// the goal's task states; mutates only the goal (state/iterations) and inserts
// generated tasks. Dispatch of newly-open tasks is the scheduler's tick (#137).
export async function progressGoal(
  db: DB, orgId: string, goalId: string,
  opts?: { gen?: NextStepGen; maxIterations?: number },
): Promise<GoalOutcome> {
  const maxIterations = opts?.maxIterations ?? MAX_ITERATIONS;
  const gen = opts?.gen ?? retryUnmet;
  const [g] = await db.select().from(goals).where(and(eq(goals.id, goalId), eq(goals.orgId, orgId)));
  if (!g) return { status: "skip", reason: "no goal" };
  if (g.state !== "active") return { status: "skip", reason: `goal ${g.state}` };

  const rows = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.goalId, goalId)));
  if (rows.length === 0) return { status: "skip", reason: "not decomposed" };

  // #140: a "live at a public URL" criterion auto-satisfies once the goal has a
  // deployed liveUrl — close that task without needing a code-merge run.
  if (g.liveUrl) {
    const liveTask = rows.find((t) => t.state !== "done" && LIVE_URL_RE.test(t.title));
    if (liveTask) {
      await db.update(tasks).set({ state: "done" }).where(and(eq(tasks.id, liveTask.id), eq(tasks.orgId, orgId)));
      liveTask.state = "done";
    }
  }

  const active = rows.filter((t) => ACTIVE.includes(t.state));
  const unmet = rows.filter((t) => t.state === "blocked");

  // All tasks satisfied → the goal's criteria are met. Close it.
  if (rows.every((t) => t.state === "done")) {
    await db.update(goals).set({ state: "done" }).where(and(eq(goals.id, goalId), eq(goals.orgId, orgId)));
    return { status: "done" };
  }
  // Work still in flight (open/in-progress) → let it run; nothing to generate yet.
  if (active.length > 0) return { status: "working", active: active.length };

  // No active tasks left but criteria unmet → the blocked tasks are the gap.
  if (g.iterations >= maxIterations) return { status: "stuck", blocked: unmet.length };

  const next = gen({ title: g.title, criteria: g.criteria }, unmet.map((t) => ({
    title: t.title, threadId: t.threadId, assigneeKind: t.assigneeKind, assigneeId: t.assigneeId,
  })));
  const taskIds: string[] = [];
  for (const n of next) {
    const id = randomUUID();
    await db.insert(tasks).values({
      id, orgId, threadId: n.threadId, title: n.title, state: "open", goalId,
      createdByKind: "agent", createdById: "planner",
      ...(n.assigneeId ? { assigneeKind: "agent", assigneeId: n.assigneeId } : {}),
    });
    taskIds.push(id);
  }
  await db.update(goals).set({ iterations: g.iterations + 1 })
    .where(and(eq(goals.id, goalId), eq(goals.orgId, orgId)));
  return { status: "generated", taskIds };
}
