import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { supportTickets } from "../db/schema.js";
import { record } from "../audit/audit-log.js";

// #152 7.1 post-sale support. A customer message becomes a tracked ticket an agent
// (or a human) can act on. Kept deliberately small: open → resolve, with a resolution
// note. The agent can list open tickets and act; resolution is auditable.

export async function openTicket(db: DB, args: { orgId: string; businessId: string; customer?: string; subject?: string; body: string }) {
  const [row] = await db.insert(supportTickets).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId,
    customer: args.customer ?? "", subject: (args.subject ?? args.body.slice(0, 80)).trim(), body: args.body, state: "open",
  }).returning();
  await record(db, { orgId: args.orgId, actorKind: "system", actorId: "support", action: "support.opened", resource: args.businessId, payload: { ticketId: row.id, customer: row.customer } });
  return row;
}

export async function listTickets(db: DB, orgId: string, businessId: string, opts?: { state?: "open" | "resolved" }) {
  const where = opts?.state
    ? and(eq(supportTickets.orgId, orgId), eq(supportTickets.businessId, businessId), eq(supportTickets.state, opts.state))
    : and(eq(supportTickets.orgId, orgId), eq(supportTickets.businessId, businessId));
  return db.select().from(supportTickets).where(where).orderBy(desc(supportTickets.createdAt));
}

export async function resolveTicket(db: DB, args: { orgId: string; ticketId: string; resolution: string; byActor?: string }) {
  const [t] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, args.ticketId), eq(supportTickets.orgId, args.orgId)));
  if (!t) return undefined;
  if (t.state === "resolved") return t; // idempotent
  const [row] = await db.update(supportTickets).set({ state: "resolved", resolution: args.resolution })
    .where(and(eq(supportTickets.id, args.ticketId), eq(supportTickets.orgId, args.orgId))).returning();
  await record(db, { orgId: args.orgId, actorKind: args.byActor ? "agent" : "system", actorId: args.byActor ?? "support", action: "support.resolved", resource: t.businessId, payload: { ticketId: t.id } });
  return row;
}
