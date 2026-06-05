import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { businessLedger } from "../db/schema.js";
import { autonomousGoals, setGoalAutonomy } from "./goals.js";

// #149.2 Tiered budget alerts + auto-suspension. As metered spend approaches a
// workspace's cap, warn; at the cap, PAUSE autonomous work (state preserved) rather
// than overspend — no bill shock. Spend is the org's metered cost (the business
// ledger 'cost' lines; the gateway's telemetry feeds these), compared to a cap.

export type BudgetTier = "ok" | "warning" | "hard";

export function budgetTier(spentCents: number, capCents: number, warnRatio = 0.6): { tier: BudgetTier; ratio: number } {
  if (capCents <= 0) return { tier: "ok", ratio: 0 }; // 0/unset cap → unmetered (no enforcement)
  const ratio = spentCents / capCents;
  return { tier: ratio >= 1 ? "hard" : ratio >= warnRatio ? "warning" : "ok", ratio };
}

// orgSpendCents: total metered cost recorded for the org (sum of ledger cost lines).
export async function orgSpendCents(db: DB, orgId: string): Promise<number> {
  const rows = await db.select({ c: businessLedger.amountCents }).from(businessLedger)
    .where(and(eq(businessLedger.orgId, orgId), eq(businessLedger.kind, "cost")));
  return rows.reduce((s, r) => s + r.c, 0);
}

export interface BudgetStatus { spentCents: number; capCents: number; tier: BudgetTier; ratio: number; pausedGoals: number }

// enforceBudget: compute the org's tier; on a HARD limit, pause every active
// autonomy goal (autonomy off, state preserved → resumes on top-up/re-enable).
// Returns the status so the scheduler can skip a maxed-out org and surface it.
export async function enforceBudget(db: DB, orgId: string, capCents: number): Promise<BudgetStatus> {
  const spentCents = await orgSpendCents(db, orgId);
  const { tier, ratio } = budgetTier(spentCents, capCents);
  let pausedGoals = 0;
  if (tier === "hard") {
    for (const g of await autonomousGoals(db, orgId)) {
      await setGoalAutonomy(db, orgId, g.id, false);
      pausedGoals++;
    }
  }
  return { spentCents, capCents, tier, ratio, pausedGoals };
}
