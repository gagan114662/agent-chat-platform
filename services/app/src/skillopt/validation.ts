// #133 validation gate: a proposed skill edit is accepted ONLY if it strictly
// improves a held-out score — propose-and-test, never blind self-editing. This is
// the guardrail that stops the optimizer from drifting on noise or self-flattery.

export interface ValidationVerdict { accept: boolean; delta: number; reason: string; }

export function acceptEdit(beforeScore: number, afterScore: number, opts?: { minDelta?: number }): ValidationVerdict {
  const minDelta = opts?.minDelta ?? 0; // strict improvement by default (> 0)
  const delta = afterScore - beforeScore;
  if (delta > minDelta) return { accept: true, delta, reason: `held-out improved by ${delta.toFixed(3)}` };
  return { accept: false, delta, reason: delta <= 0 ? `no improvement (Δ ${delta.toFixed(3)})` : `improvement ${delta.toFixed(3)} below minDelta ${minDelta}` };
}
