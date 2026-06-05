import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { agentReputation } from "../db/schema.js";
import { score, type Reputation } from "./reputation.js";

// #128 persistence: record verified run outcomes and read back the score. The pure
// scoring math lives in reputation.ts; this is the thin store + the live hook the
// fusion activity calls when a run terminates.

export async function recordOutcome(db: DB, orgId: string, agentId: string, outcome: "success" | "fail") {
  const col = outcome === "success" ? "success" : "fail";
  // Upsert: insert a row at 1 for this outcome, or increment the existing counter.
  await db.insert(agentReputation)
    .values({ orgId, agentId, success: outcome === "success" ? 1 : 0, fail: outcome === "fail" ? 1 : 0 })
    .onConflictDoUpdate({
      target: [agentReputation.orgId, agentReputation.agentId],
      set: { [col]: (await currentCount(db, orgId, agentId, col)) + 1 },
    });
}

async function currentCount(db: DB, orgId: string, agentId: string, col: "success" | "fail"): Promise<number> {
  const [r] = await db.select().from(agentReputation).where(and(eq(agentReputation.orgId, orgId), eq(agentReputation.agentId, agentId)));
  return r ? Number(r[col]) : 0;
}

export interface AgentReputation extends Reputation { scorePct: number; runs: number; }

export async function getReputation(db: DB, orgId: string, agentId: string): Promise<AgentReputation> {
  const [r] = await db.select().from(agentReputation).where(and(eq(agentReputation.orgId, orgId), eq(agentReputation.agentId, agentId)));
  const rep: Reputation = { id: agentId, success: r ? Number(r.success) : 0, fail: r ? Number(r.fail) : 0 };
  return { ...rep, runs: rep.success + rep.fail, scorePct: Math.round(score(rep) * 100) };
}

export async function listReputations(db: DB, orgId: string): Promise<Record<string, AgentReputation>> {
  const rows = await db.select().from(agentReputation).where(eq(agentReputation.orgId, orgId));
  const out: Record<string, AgentReputation> = {};
  for (const r of rows) {
    const rep: Reputation = { id: r.agentId, success: Number(r.success), fail: Number(r.fail) };
    out[r.agentId] = { ...rep, runs: rep.success + rep.fail, scorePct: Math.round(score(rep) * 100) };
  }
  return out;
}
