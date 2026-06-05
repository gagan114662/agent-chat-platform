import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { runs, tasks } from "../db/schema.js";
import { latestSkill, saveSkillVersion } from "../agents/skills.js";
import { optimizeStep, type Proposer, type Evaluator, type Rollout } from "./optimizer.js";
import { RejectedBuffer } from "./rejected-buffer.js";

// Live wiring of the SkillOpt loop (#132). Pulls REAL scored rollouts from the
// agent's recent runs, proposes an edit, validates it on a held-out score, and —
// only if it strictly improves — saves a NEW skill version (#131). Proposer +
// evaluator are injectable: defaults are deterministic heuristics that operate on
// real run data; production can pass an LLM proposer and a held-out-replay evaluator.

const EDIT_BUDGET = { maxChars: 280 };

// Concrete, reusable lessons keyed to a failure signal — the heuristic proposer
// appends the first relevant one not already in the doc. Each is also what the
// evaluator rewards, so adding a relevant lesson strictly improves the score.
const LESSONS: { trigger: RegExp; text: string }[] = [
  { trigger: /checks_failed|fail/i, text: "- Run the test suite locally and make checks pass before opening the PR." },
  { trigger: /timeout/i, text: "- Keep the change small and focused so the run completes well within the time budget." },
  { trigger: /error/i, text: "- Read the error output and fix the root cause before re-running; don't retry blindly." },
];
const DEFAULT_LESSON = "- Make the smallest change that satisfies the task's acceptance criteria.";

// gatherRollouts: the agent's recent runs as scored rollouts (merged = 1, failure
// = 0, in-flight/held = 0.5), newest first.
export async function gatherRollouts(db: DB, orgId: string, agentId: string, limit = 20): Promise<Rollout[]> {
  const rows = await db.select({ state: runs.state, title: tasks.title }).from(runs)
    .innerJoin(tasks, and(eq(tasks.id, runs.taskId), eq(tasks.orgId, orgId)))
    .where(and(eq(runs.orgId, orgId), eq(tasks.assigneeKind, "agent"), eq(tasks.assigneeId, agentId)))
    .orderBy(desc(runs.id)).limit(limit);
  return rows.map((r) => ({
    score: r.state === "merged" ? 1 : ["checks_failed", "timeout", "error"].includes(r.state) ? 0 : 0.5,
    transcript: `${r.title} → ${r.state}`,
  }));
}

// heuristicProposer: turn failure signal into a concrete lesson append. If no
// matching lesson (or it's already present), fall back to the default lesson.
export const heuristicProposer: Proposer = (doc, rollouts) => {
  const failureText = rollouts.filter((r) => r.score < 1).map((r) => r.transcript ?? "").join(" ");
  for (const l of LESSONS) {
    if (l.trigger.test(failureText) && !doc.includes(l.text)) {
      return { op: "append", text: `\n${l.text}` };
    }
  }
  return { op: "append", text: doc.includes(DEFAULT_LESSON) ? "\n" : `\n${DEFAULT_LESSON}` };
};

// heuristicEvaluator: a doc-conditioned held-out proxy — rewards the presence of
// known-good lessons (each agents toward fewer failures) with a length penalty so
// the doc can't grow unboundedly. Deterministic; a real evaluator replays the
// agent with the candidate doc on a held-out task set.
export const heuristicEvaluator: Evaluator = (doc) => {
  const lessons = [...LESSONS.map((l) => l.text), DEFAULT_LESSON];
  const present = lessons.filter((t) => doc.includes(t)).length;
  const lengthPenalty = Math.max(0, doc.length - 2000) * 0.0005;
  return Math.min(1, 0.5 + present * 0.12) - lengthPenalty;
};

export interface OptimizeOutcome {
  accepted: boolean;
  version?: number;
  edit?: unknown;
  reason: string;
  beforeScore: number;
  afterScore?: number;
}

// optimizeAgentSkill: one live optimization step for an agent's skill document.
export async function optimizeAgentSkill(
  db: DB, orgId: string, agentId: string,
  deps?: { propose?: Proposer; evaluate?: Evaluator },
): Promise<OptimizeOutcome> {
  const doc = (await latestSkill(db, orgId, agentId))?.content ?? "";
  const rollouts = await gatherRollouts(db, orgId, agentId);
  const res = optimizeStep(
    doc, rollouts,
    deps?.propose ?? heuristicProposer,
    deps?.evaluate ?? heuristicEvaluator,
    EDIT_BUDGET, new RejectedBuffer(),
  );
  if (!res.accepted) {
    return { accepted: false, edit: res.edit, reason: res.reason, beforeScore: res.beforeScore, afterScore: res.afterScore };
  }
  const saved = await saveSkillVersion(db, orgId, agentId, res.doc);
  return { accepted: true, version: saved.version, edit: res.edit, reason: res.reason, beforeScore: res.beforeScore, afterScore: res.afterScore };
}
