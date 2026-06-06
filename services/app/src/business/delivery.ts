import { randomUUID } from "node:crypto";
import { and, eq, desc, sql as dsql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { deliveries, businesses } from "../db/schema.js";
import { record } from "../audit/audit-log.js";

// #152 5.1 the fulfill→deliver handoff. When a payment is approved (revenue booked),
// the customer is owed the thing they paid for. A delivery is created PENDING and then
// fulfilled with the concrete artifact — the business's live URL by default (the
// deployed product), or a file/access grant. This closes the loop: paid → delivered.

export async function createDelivery(db: DB, args: { orgId: string; businessId: string; customer?: string; paymentIntentId?: string; kind?: string; artifact?: string }) {
  // idempotent per payment intent: one approval → at most one delivery.
  if (args.paymentIntentId) {
    const [existing] = await db.select().from(deliveries).where(and(eq(deliveries.orgId, args.orgId), eq(deliveries.paymentIntentId, args.paymentIntentId)));
    if (existing) return existing;
  }
  const [row] = await db.insert(deliveries).values({
    id: randomUUID(), orgId: args.orgId, businessId: args.businessId,
    customer: args.customer ?? "", paymentIntentId: args.paymentIntentId ?? null,
    kind: args.kind ?? "url", artifact: args.artifact ?? "", state: "pending",
  }).returning();
  return row;
}

export async function listDeliveries(db: DB, orgId: string, businessId: string) {
  return db.select().from(deliveries).where(and(eq(deliveries.orgId, orgId), eq(deliveries.businessId, businessId))).orderBy(desc(deliveries.createdAt));
}

// Fulfill: hand the artifact to the customer. If no artifact is given, fall back to the
// business's live URL (the deployed product they bought). Marks the delivery delivered.
export async function fulfillDelivery(db: DB, args: { orgId: string; deliveryId: string; artifact?: string; kind?: string }) {
  const [d] = await db.select().from(deliveries).where(and(eq(deliveries.id, args.deliveryId), eq(deliveries.orgId, args.orgId)));
  if (!d) return undefined;
  if (d.state === "delivered") return d; // idempotent
  let artifact = args.artifact ?? d.artifact;
  if (!artifact) {
    const [b] = await db.select({ liveUrl: businesses.liveUrl }).from(businesses).where(and(eq(businesses.id, d.businessId), eq(businesses.orgId, args.orgId)));
    artifact = b?.liveUrl ?? "";
  }
  const [row] = await db.update(deliveries)
    .set({ state: "delivered", artifact, kind: args.kind ?? d.kind, deliveredAt: dsql`now()` })
    .where(and(eq(deliveries.id, args.deliveryId), eq(deliveries.orgId, args.orgId))).returning();
  await record(db, { orgId: args.orgId, actorKind: "system", actorId: "delivery", action: "delivery.fulfilled", resource: d.businessId, payload: { deliveryId: d.id, customer: d.customer, kind: row.kind, artifact } });
  return row;
}
