import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { paymentDecisions } from "../db/schema.js";

// #114 RLHF capture: record + read human decisions on gated payments, and derive
// a data-driven auto-approve threshold from the org's real approve/decline history.

export type DecisionKind = "approve" | "decline" | "modify";

export interface RecordDecisionInput {
  orgId: string;
  agentId?: string | null;
  tool: string;
  amountCents: number;
  recipient?: string | null;
  justification?: string;
  decision: DecisionKind;
  modifiedAmountCents?: number | null;
  reason?: string;
}

export async function recordDecision(db: DB, i: RecordDecisionInput) {
  const [row] = await db.insert(paymentDecisions).values({
    id: randomUUID(),
    orgId: i.orgId,
    agentId: i.agentId ?? null,
    tool: i.tool,
    amountCents: i.amountCents,
    recipient: i.recipient ?? null,
    justification: i.justification ?? "",
    decision: i.decision,
    modifiedAmountCents: i.modifiedAmountCents ?? null,
    reason: i.reason ?? "",
  }).returning();
  return row;
}

// listDecisions: the org's decision log, newest first — the audit trail (#115) and
// the RLHF dataset.
export async function listDecisions(db: DB, orgId: string, limit = 500) {
  return db.select().from(paymentDecisions)
    .where(eq(paymentDecisions.orgId, orgId))
    .orderBy(desc(paymentDecisions.createdAt))
    .limit(limit);
}

export interface ThresholdSuggestion {
  suggestedCents: number;
  approvals: number;
  declines: number;
  maxApprovedCents: number;
  minDeclinedCents: number | null;
}

// suggestAutoApproveThreshold: the safe-autonomy threshold can widen as agents
// prove reliable. Suggest the largest amount safely under the org's behaviour:
// up to the max approved amount, but never at/above the smallest declined amount.
export async function suggestAutoApproveThreshold(db: DB, orgId: string): Promise<ThresholdSuggestion> {
  const rows = await db.select().from(paymentDecisions).where(eq(paymentDecisions.orgId, orgId));
  const approved = rows.filter((r) => r.decision === "approve" && r.amountCents > 0).map((r) => r.amountCents);
  const declined = rows.filter((r) => r.decision === "decline" && r.amountCents > 0).map((r) => r.amountCents);
  const maxApproved = approved.length ? Math.max(...approved) : 0;
  const minDeclined = declined.length ? Math.min(...declined) : null;
  // Stay strictly below the smallest decline; otherwise allow up to the max approved.
  const suggested = minDeclined === null ? maxApproved : Math.min(maxApproved, minDeclined - 1);
  return {
    suggestedCents: Math.max(0, suggested),
    approvals: approved.length,
    declines: declined.length,
    maxApprovedCents: maxApproved,
    minDeclinedCents: minDeclined,
  };
}
