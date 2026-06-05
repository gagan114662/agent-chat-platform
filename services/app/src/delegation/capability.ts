import type { Criticality } from "./risk.js";

// #127 capability-aware task assignment: route each task to the best-matched agent
// or human via capability profiles (skills + the max criticality they're trusted
// with). Pure scoring — the assigner picks the top match.

const RANK: Record<Criticality, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export interface CapabilityProfile {
  id: string;            // agent or human id
  kind: "agent" | "human";
  skills: string[];      // e.g. ["frontend", "stripe", "copywriting"]
  maxCriticality: Criticality; // the most critical work they may take
}

export interface TaskNeed {
  skills: string[];
  criticality: Criticality;
}

export interface Match { id: string; kind: "agent" | "human"; score: number; }

// matchTask scores each eligible profile by skill overlap and returns the best.
// A profile is eligible only if its maxCriticality covers the task's criticality.
// Ties break toward agents (prefer autonomous execution). null = no eligible match.
export function matchTask(need: TaskNeed, profiles: CapabilityProfile[]): Match | null {
  const needRank = RANK[need.criticality];
  const wanted = new Set(need.skills.map((s) => s.toLowerCase()));
  let best: Match | null = null;
  for (const p of profiles) {
    if (RANK[p.maxCriticality] < needRank) continue; // not trusted with this criticality
    const overlap = p.skills.filter((s) => wanted.has(s.toLowerCase())).length;
    const score = overlap;
    if (!best || score > best.score || (score === best.score && p.kind === "agent" && best.kind === "human")) {
      best = { id: p.id, kind: p.kind, score };
    }
  }
  return best;
}
