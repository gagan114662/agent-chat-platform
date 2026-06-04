import { randomUUID } from "node:crypto";
import { and, eq, ilike, or, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { memoryNodes, memoryEdges } from "../db/schema.js";

export type NodeKind = "decision" | "fact" | "preference" | "identity" | "artifact";
export type Scope = "personal" | "project" | "team" | "org";

export interface NewNode { orgId: string; kind: NodeKind; label: string; body?: string; scope?: Scope; metadata?: Record<string, unknown>; }

export async function createNode(db: DB, n: NewNode) {
  const [node] = await db.insert(memoryNodes).values({
    id: randomUUID(), orgId: n.orgId, kind: n.kind, scope: n.scope ?? "org",
    label: n.label, body: n.body ?? "", metadata: n.metadata ?? {},
  }).returning();
  return node;
}

export async function createEdge(db: DB, e: { orgId: string; fromId: string; toId: string; relation: string }) {
  const [edge] = await db.insert(memoryEdges).values({ id: randomUUID(), ...e }).onConflictDoNothing().returning();
  return edge;
}

export async function listNodes(db: DB, orgId: string, filter: { kind?: NodeKind; scope?: Scope } = {}) {
  const conds = [eq(memoryNodes.orgId, orgId)];
  if (filter.kind) conds.push(eq(memoryNodes.kind, filter.kind));
  if (filter.scope) conds.push(eq(memoryNodes.scope, filter.scope));
  return db.select().from(memoryNodes).where(and(...conds));
}

export async function neighbors(db: DB, nodeId: string, orgId: string) {
  const edges = await db.select().from(memoryEdges).where(and(
    eq(memoryEdges.orgId, orgId),
    or(eq(memoryEdges.fromId, nodeId), eq(memoryEdges.toId, nodeId)),
  ));
  const ids = [...new Set(edges.flatMap((e) => [e.fromId, e.toId]).filter((id) => id !== nodeId))];
  if (ids.length === 0) return [];
  return db.select().from(memoryNodes).where(and(eq(memoryNodes.orgId, orgId), inArray(memoryNodes.id, ids)));
}

export async function searchNodes(db: DB, orgId: string, q: string) {
  if (!q.trim()) return [];
  return db.select().from(memoryNodes).where(and(
    eq(memoryNodes.orgId, orgId),
    or(ilike(memoryNodes.label, `%${q}%`), ilike(memoryNodes.body, `%${q}%`)),
  ));
}

export async function counts(db: DB, orgId: string): Promise<{ nodes: number; edges: number }> {
  const [n] = await db.select({ c: sql<number>`count(*)::int` }).from(memoryNodes).where(eq(memoryNodes.orgId, orgId));
  const [e] = await db.select({ c: sql<number>`count(*)::int` }).from(memoryEdges).where(eq(memoryEdges.orgId, orgId));
  return { nodes: n?.c ?? 0, edges: e?.c ?? 0 };
}

export interface MemoryGraph { nodes: Awaited<ReturnType<typeof listNodes>>; edges: { id: string; fromId: string; toId: string; relation: string }[]; }

// Returns the org's nodes (optionally filtered) + the edges among those nodes.
export async function graph(db: DB, orgId: string, filter: { kind?: NodeKind; scope?: Scope } = {}): Promise<MemoryGraph> {
  const nodes = await listNodes(db, orgId, filter);
  const ids = new Set(nodes.map((n) => n.id));
  const all = await db.select().from(memoryEdges).where(eq(memoryEdges.orgId, orgId));
  const edges = all
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation }));
  return { nodes, edges };
}
