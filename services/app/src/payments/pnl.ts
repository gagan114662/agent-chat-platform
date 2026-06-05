import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { treasuryLedger } from "../db/schema.js";

// #119 profitability engine: per-business P&L + cost attribution over the treasury
// ledger (#118 — credits = revenue, debits = cost), and a profit-optimizing goal
// suggestion the autonomy loop (#67) can act on.

export interface PnL {
  revenueCents: number;
  costCents: number;
  profitCents: number;
  marginPct: number; // profit / revenue, 0 when no revenue
  revenueBySource: Record<string, number>;
  costBySource: Record<string, number>;
}

export async function profitAndLoss(db: DB, orgId: string): Promise<PnL> {
  const rows = await db.select().from(treasuryLedger).where(eq(treasuryLedger.orgId, orgId));
  let revenueCents = 0;
  let costCents = 0;
  const revenueBySource: Record<string, number> = {};
  const costBySource: Record<string, number> = {};
  for (const r of rows) {
    if (r.direction === "credit") {
      revenueCents += r.amountCents;
      revenueBySource[r.source] = (revenueBySource[r.source] ?? 0) + r.amountCents;
    } else {
      costCents += r.amountCents;
      costBySource[r.source] = (costBySource[r.source] ?? 0) + r.amountCents;
    }
  }
  const profitCents = revenueCents - costCents;
  const marginPct = revenueCents > 0 ? Math.round((profitCents / revenueCents) * 1000) / 10 : 0;
  return { revenueCents, costCents, profitCents, marginPct, revenueBySource, costBySource };
}

// topBySource returns the largest entry of a {source: cents} map, or null.
export function topBySource(m: Record<string, number>): { source: string; cents: number } | null {
  let best: { source: string; cents: number } | null = null;
  for (const [source, cents] of Object.entries(m)) {
    if (!best || cents > best.cents) best = { source, cents };
  }
  return best;
}

// suggestProfitGoal: a concrete, outcome-shaped goal the autonomy loop can pursue —
// cut the biggest cost if unprofitable/thin margin, else grow the biggest revenue line.
export function suggestProfitGoal(pnl: PnL): string {
  if (pnl.revenueCents === 0 && pnl.costCents === 0) {
    return "No financial activity yet — set up a revenue source (invoice or checkout) to start the P&L.";
  }
  const topCost = topBySource(pnl.costBySource);
  if (pnl.profitCents <= 0 && topCost) {
    return `Unprofitable (margin ${pnl.marginPct}%). Cut the biggest cost: "${topCost.source}" ($${(topCost.cents / 100).toFixed(2)}) by 20%.`;
  }
  const topRev = topBySource(pnl.revenueBySource);
  if (topRev) {
    return `Profitable (margin ${pnl.marginPct}%). Grow the top revenue line: "${topRev.source}" ($${(topRev.cents / 100).toFixed(2)}) by 25%.`;
  }
  return `Margin ${pnl.marginPct}%. Add a revenue source to grow profit.`;
}
