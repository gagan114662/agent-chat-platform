import { applyEdit, type SkillEdit, type EditBudget, type ProtectedCore } from "./edit.js";
import { acceptEdit } from "./validation.js";
import { RejectedBuffer } from "./rejected-buffer.js";

// #132 closed-loop skill optimization. One step of the loop:
//   forward pass:  run the agent on tasks → scored rollouts (provided)
//   backward pass: propose a skill edit from those rollouts (injected proposer)
//   then: skip if already-rejected (#135) → apply bounded (#134) → re-evaluate on a
//   held-out set → accept ONLY if it strictly improves (#133), else buffer the
//   rejection. Proposer + evaluator are injected (an LLM in production; pure in tests).

export interface Rollout { score: number; transcript?: string; }
export type Proposer = (doc: string, rollouts: Rollout[]) => SkillEdit;
export type Evaluator = (doc: string) => number; // held-out score for a candidate doc

export interface OptimizeStepResult {
  doc: string;
  accepted: boolean;
  edit?: SkillEdit;
  reason: string;
  beforeScore: number;
  afterScore?: number;
}

export function optimizeStep(
  doc: string,
  rollouts: Rollout[],
  propose: Proposer,
  evaluate: Evaluator,
  budget: EditBudget,
  rejected: RejectedBuffer,
  core?: ProtectedCore,
): OptimizeStepResult {
  const beforeScore = evaluate(doc);
  const edit = propose(doc, rollouts);

  if (rejected.has(edit)) {
    return { doc, accepted: false, edit, reason: "edit already rejected (skipped)", beforeScore };
  }
  const applied = applyEdit(doc, edit, budget, core);
  if (!applied.ok) {
    return { doc, accepted: false, edit, reason: applied.reason ?? "edit rejected", beforeScore };
  }
  const afterScore = evaluate(applied.doc!);
  const verdict = acceptEdit(beforeScore, afterScore);
  if (!verdict.accept) {
    rejected.add(edit, afterScore - beforeScore, verdict.reason);
    return { doc, accepted: false, edit, reason: verdict.reason, beforeScore, afterScore };
  }
  return { doc: applied.doc!, accepted: true, edit, reason: verdict.reason, beforeScore, afterScore };
}
