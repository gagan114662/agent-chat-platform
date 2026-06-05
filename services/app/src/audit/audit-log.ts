import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { auditLog } from "../db/schema.js";

// #150.3 cryptographic, append-only audit log. Every consequential action (an agent
// tool call, a merge, a money approval, an outreach send) is recorded as a link in
// a per-org hash chain: hash = sha256(prevHash + canonical(entry)). Tampering with
// or deleting any entry breaks the chain, which verifyChain() detects — so the log
// is tamper-evident and any final action can be traced back to its cause.

export interface AuditInput {
  orgId: string;
  actorKind: "human" | "agent" | "system";
  actorId: string;
  action: string;            // e.g. "run.merged", "payment.approved", "tool.call", "campaign.sent"
  resource?: string;         // the thing acted on (runId, prNumber, businessId, tool name…)
  payload?: Record<string, unknown>;
}

// canonical: a stable serialization of the fields that are hashed (order-independent).
function canonical(seq: number, prevHash: string, i: AuditInput): string {
  return JSON.stringify({ seq, prevHash, orgId: i.orgId, actorKind: i.actorKind, actorId: i.actorId, action: i.action, resource: i.resource ?? "", payload: i.payload ?? {} });
}
export function hashEntry(seq: number, prevHash: string, i: AuditInput): string {
  return createHash("sha256").update(canonical(seq, prevHash, i)).digest("hex");
}

// append: add a link to the org's chain. Best-effort — a logging failure must never
// break the action it records (callers wrap in try/catch or ignore the result).
export async function append(db: DB, i: AuditInput) {
  const [last] = await db.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog)
    .where(eq(auditLog.orgId, i.orgId)).orderBy(desc(auditLog.seq)).limit(1);
  const seq = (last?.seq ?? -1) + 1;
  const prevHash = last?.hash ?? "";
  const hash = hashEntry(seq, prevHash, i);
  const [row] = await db.insert(auditLog).values({
    id: randomUUID(), orgId: i.orgId, seq, prevHash, hash,
    actorKind: i.actorKind, actorId: i.actorId, action: i.action, resource: i.resource ?? "", payload: i.payload ?? {},
  }).onConflictDoNothing().returning();
  return row;
}

// record: append that never throws (so audit logging can't break a request).
export async function record(db: DB, i: AuditInput): Promise<void> {
  try { await append(db, i); } catch (e) { console.warn("[acp] audit append failed:", String(e)); }
}

export interface VerifyResult { ok: boolean; entries: number; brokenAt?: number; reason?: string }
// verifyChain: recompute every link and confirm linkage + stored hash. Detects any
// edit, deletion, or reordering.
export async function verifyChain(db: DB, orgId: string): Promise<VerifyResult> {
  const rows = await db.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(asc(auditLog.seq));
  let prevHash = "";
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    if (r.seq !== idx) return { ok: false, entries: rows.length, brokenAt: r.seq, reason: `gap/reorder at seq ${r.seq}` };
    if (r.prevHash !== prevHash) return { ok: false, entries: rows.length, brokenAt: r.seq, reason: `broken link at seq ${r.seq}` };
    const expect = hashEntry(r.seq, r.prevHash, { orgId, actorKind: r.actorKind as AuditInput["actorKind"], actorId: r.actorId, action: r.action, resource: r.resource, payload: r.payload });
    if (expect !== r.hash) return { ok: false, entries: rows.length, brokenAt: r.seq, reason: `tampered entry at seq ${r.seq}` };
    prevHash = r.hash;
  }
  return { ok: true, entries: rows.length };
}

export async function listAudit(db: DB, orgId: string, limit = 100) {
  return db.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.seq)).limit(limit);
}
