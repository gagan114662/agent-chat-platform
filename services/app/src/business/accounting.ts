import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { businessLedger, businesses } from "../db/schema.js";

// #152 8.2 revenue recognition / accounting. Rolls the per-business ledger lines into
// an income statement: revenue and cost broken out by source, gross margin, and a
// margin %. This is what makes "profitable" a number, not a vibe.

export interface IncomeStatement {
  businessId: string;
  revenueCents: number;
  costCents: number;
  netCents: number;
  marginPct: number;            // net / revenue, 0 when no revenue
  profitable: boolean;
  revenueBySource: Record<string, number>;
  costBySource: Record<string, number>;
}

export async function incomeStatement(db: DB, orgId: string, businessId: string): Promise<IncomeStatement> {
  const rows = await db.select().from(businessLedger).where(and(eq(businessLedger.orgId, orgId), eq(businessLedger.businessId, businessId)));
  let revenueCents = 0, costCents = 0;
  const revenueBySource: Record<string, number> = {};
  const costBySource: Record<string, number> = {};
  for (const r of rows) {
    if (r.kind === "revenue") { revenueCents += r.amountCents; revenueBySource[r.source] = (revenueBySource[r.source] ?? 0) + r.amountCents; }
    else { costCents += r.amountCents; costBySource[r.source] = (costBySource[r.source] ?? 0) + r.amountCents; }
  }
  const netCents = revenueCents - costCents;
  const marginPct = revenueCents > 0 ? Math.round((netCents / revenueCents) * 1000) / 10 : 0;
  return { businessId, revenueCents, costCents, netCents, marginPct, profitable: netCents > 0, revenueBySource, costBySource };
}

export interface PortfolioPnl {
  businesses: (IncomeStatement & { name: string })[];
  totalRevenueCents: number;
  totalCostCents: number;
  totalNetCents: number;
  profitableCount: number;
}

// Org-wide roll-up across every business — the portfolio view.
export async function portfolioPnl(db: DB, orgId: string): Promise<PortfolioPnl> {
  const list = await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.orgId, orgId));
  const statements = await Promise.all(list.map(async (b) => ({ ...(await incomeStatement(db, orgId, b.id)), name: b.name })));
  return {
    businesses: statements,
    totalRevenueCents: statements.reduce((s, x) => s + x.revenueCents, 0),
    totalCostCents: statements.reduce((s, x) => s + x.costCents, 0),
    totalNetCents: statements.reduce((s, x) => s + x.netCents, 0),
    profitableCount: statements.filter((x) => x.profitable).length,
  };
}
