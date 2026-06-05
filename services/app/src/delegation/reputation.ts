// #128 trust & reputation: a score per agent/human from verified outcomes, used to
// (a) bias capability matching (#127) and (b) gate standing permissions — an actor
// only earns autonomous/standing rights after a track record. Pure; persistence is
// a thin store on top.

export interface Reputation {
  id: string;
  success: number;
  fail: number;
}

// score: Laplace-smoothed success rate (prior 1/1) so a brand-new actor sits at
// 0.5, not 0 or 1. Range (0,1).
export function score(r: Reputation): number {
  return (r.success + 1) / (r.success + r.fail + 2);
}

export function update(r: Reputation, outcome: "success" | "fail"): Reputation {
  return outcome === "success" ? { ...r, success: r.success + 1 } : { ...r, fail: r.fail + 1 };
}

// meetsStanding: an actor earns a standing permission only after enough runs AND a
// score at/above the threshold — so trust is earned, not granted.
export function meetsStanding(r: Reputation, opts: { minRuns: number; minScore: number }): boolean {
  const runs = r.success + r.fail;
  return runs >= opts.minRuns && score(r) >= opts.minScore;
}
