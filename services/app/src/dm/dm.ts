import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members, agents, threads } from "../db/schema.js";

export interface Principal { kind: "human" | "agent"; id: string; name: string; }

export async function listPrincipals(db: DB, orgId: string, excludeMemberId?: string): Promise<Principal[]> {
  const ms = await db.select().from(members).where(eq(members.orgId, orgId));
  const as = await db.select().from(agents).where(eq(agents.orgId, orgId));
  return [
    ...ms.filter((m) => m.id !== excludeMemberId).map((m) => ({ kind: "human" as const, id: m.id, name: m.displayName })),
    ...as.map((a) => ({ kind: "agent" as const, id: a.id, name: a.displayName })),
  ];
}

async function peerName(db: DB, peerKind: "human" | "agent", peerId: string): Promise<string | undefined> {
  if (peerKind === "human") {
    const [m] = await db.select().from(members).where(eq(members.id, peerId));
    return m?.displayName;
  }
  const [a] = await db.select().from(agents).where(eq(agents.id, peerId));
  return a?.displayName;
}

export async function getOrCreateDm(db: DB, input: { orgId: string; peerKind: "human" | "agent"; peerId: string }) {
  const [existing] = await db.select().from(threads).where(and(
    eq(threads.orgId, input.orgId),
    eq(threads.kind, "dm"),
    eq(threads.dmPeerKind, input.peerKind),
    eq(threads.dmPeerId, input.peerId),
  ));
  if (existing) return existing;
  const name = await peerName(db, input.peerKind, input.peerId);
  if (!name) throw new Error(`principal not found: ${input.peerKind}/${input.peerId}`);
  const [t] = await db.insert(threads).values({
    id: randomUUID(), orgId: input.orgId, channelId: null, title: name,
    kind: "dm", dmPeerKind: input.peerKind, dmPeerId: input.peerId,
  }).returning();
  return t;
}

export function listDms(db: DB, orgId: string) {
  return db.select().from(threads)
    .where(and(eq(threads.orgId, orgId), eq(threads.kind, "dm")))
    .orderBy(desc(threads.createdAt));
}
