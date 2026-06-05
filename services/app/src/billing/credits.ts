import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { creditLedger } from "../db/schema.js";

// #148 prepaid credit ledger + pre-flight token budgeting. Users buy credits;
// metered agent compute decrements them. A call is never executed if the user
// can't afford it — they get a clean "top up" path, never a raw 402 mid-generation.
// Real money in (Stripe) is operator-supplied; this is the ledger + enforcement.

export async function balanceCents(db: DB, orgId: string): Promise<number> {
  const [row] = await db.select({ s: sql<number>`coalesce(sum(${creditLedger.deltaCents}), 0)` })
    .from(creditLedger).where(eq(creditLedger.orgId, orgId));
  return Number(row?.s ?? 0);
}

// topUp: add credits (a grant, or the settled result of a real top-up payment).
export async function topUp(db: DB, orgId: string, cents: number, reason = "top-up"): Promise<number> {
  if (cents <= 0) throw new Error("top-up must be positive");
  await db.insert(creditLedger).values({ id: randomUUID(), orgId, deltaCents: Math.round(cents), reason });
  return balanceCents(db, orgId);
}

// meter: record metered usage (a negative delta). Returns the new balance.
export async function meter(db: DB, orgId: string, cents: number, reason = "agent compute"): Promise<number> {
  if (cents <= 0) return balanceCents(db, orgId);
  await db.insert(creditLedger).values({ id: randomUUID(), orgId, deltaCents: -Math.round(cents), reason });
  return balanceCents(db, orgId);
}

export async function recentLedger(db: DB, orgId: string, limit = 50) {
  return db.select().from(creditLedger).where(eq(creditLedger.orgId, orgId)).orderBy(desc(creditLedger.createdAt)).limit(limit);
}

// affordableMaxTokens: the most OUTPUT tokens the balance can pay for at this
// model's output price. The pre-flight ceiling is min(task cap, affordable).
export function affordableMaxTokens(balanceCents: number, outCostPer1k: number): number {
  if (outCostPer1k <= 0) return Number.MAX_SAFE_INTEGER;
  const dollars = balanceCents / 100;
  return Math.max(0, Math.floor((dollars / outCostPer1k) * 1000));
}

export interface Preflight { ok: boolean; maxTokens: number; reason: string }

// preflight: given the balance + a model's output price + the requested cap, decide
// whether to run and at what max_tokens. metering off (cap signal) → always ok.
export function preflight(balanceCents: number, outCostPer1k: number, requestedMax: number, opts?: { metered?: boolean }): Preflight {
  if (opts?.metered === false) return { ok: true, maxTokens: requestedMax, reason: "unmetered" };
  if (balanceCents <= 0) return { ok: false, maxTokens: 0, reason: "insufficient credits — please top up to run agents" };
  const affordable = affordableMaxTokens(balanceCents, outCostPer1k);
  if (affordable <= 0) return { ok: false, maxTokens: 0, reason: "insufficient credits for this model — top up" };
  return { ok: true, maxTokens: Math.min(requestedMax, affordable), reason: affordable < requestedMax ? "capped to affordable tokens" : "ok" };
}

// metered: is per-run/token metering active? (ACP_CENTS_PER_RUN > 0 or an explicit flag.)
export function meteringEnabled(): boolean {
  return Number(process.env.ACP_CENTS_PER_RUN ?? 0) > 0;
}
export function centsPerRun(): number { return Number(process.env.ACP_CENTS_PER_RUN ?? 0); }
