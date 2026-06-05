import { randomUUID } from "node:crypto";
import { and, eq, ilike, or, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { memoryNodes, memoryEdges } from "../db/schema.js";

export type NodeKind = "decision" | "fact" | "preference" | "identity" | "artifact";
export type Scope = "personal" | "project" | "team" | "org";

export interface NewNode { orgId: string; kind: NodeKind; label: string; body?: string; scope?: Scope; metadata?: Record<string, unknown>; derivedFrom?: string[]; version?: number; }

// `includeInactive` opts into returning invalidated/superseded nodes (default: active only).
export interface VisibilityOpts { includeInactive?: boolean; }

export async function createNode(db: DB, n: NewNode) {
  const [node] = await db.insert(memoryNodes).values({
    id: randomUUID(), orgId: n.orgId, kind: n.kind, scope: n.scope ?? "org",
    label: n.label, body: n.body ?? "", metadata: n.metadata ?? {},
    version: n.version ?? 1,
  }).returning();
  // provenance: link the new node to each source via a derived_from edge (org-scoped).
  for (const srcId of n.derivedFrom ?? []) {
    await createEdge(db, { orgId: n.orgId, fromId: node.id, toId: srcId, relation: "derived_from" });
  }
  return node;
}

export async function createEdge(db: DB, e: { orgId: string; fromId: string; toId: string; relation: string }) {
  const [edge] = await db.insert(memoryEdges).values({ id: randomUUID(), ...e }).onConflictDoNothing().returning();
  return edge;
}

export async function listNodes(db: DB, orgId: string, filter: { kind?: NodeKind; scope?: Scope } = {}, opts: VisibilityOpts = {}) {
  const conds = [eq(memoryNodes.orgId, orgId)];
  if (filter.kind) conds.push(eq(memoryNodes.kind, filter.kind));
  if (filter.scope) conds.push(eq(memoryNodes.scope, filter.scope));
  if (!opts.includeInactive) conds.push(eq(memoryNodes.status, "active"));
  return db.select().from(memoryNodes).where(and(...conds));
}

export async function neighbors(db: DB, nodeId: string, orgId: string, opts: VisibilityOpts = {}) {
  const edges = await db.select().from(memoryEdges).where(and(
    eq(memoryEdges.orgId, orgId),
    or(eq(memoryEdges.fromId, nodeId), eq(memoryEdges.toId, nodeId)),
  ));
  const ids = [...new Set(edges.flatMap((e) => [e.fromId, e.toId]).filter((id) => id !== nodeId))];
  if (ids.length === 0) return [];
  const conds = [eq(memoryNodes.orgId, orgId), inArray(memoryNodes.id, ids)];
  if (!opts.includeInactive) conds.push(eq(memoryNodes.status, "active"));
  return db.select().from(memoryNodes).where(and(...conds));
}

export async function searchNodes(db: DB, orgId: string, q: string, opts: VisibilityOpts = {}) {
  if (!q.trim()) return [];
  const conds = [
    eq(memoryNodes.orgId, orgId),
    or(ilike(memoryNodes.label, `%${q}%`), ilike(memoryNodes.body, `%${q}%`)),
  ];
  if (!opts.includeInactive) conds.push(eq(memoryNodes.status, "active"));
  return db.select().from(memoryNodes).where(and(...conds));
}

export async function counts(db: DB, orgId: string): Promise<{ nodes: number; edges: number }> {
  const [n] = await db.select({ c: sql<number>`count(*)::int` }).from(memoryNodes).where(eq(memoryNodes.orgId, orgId));
  const [e] = await db.select({ c: sql<number>`count(*)::int` }).from(memoryEdges).where(eq(memoryEdges.orgId, orgId));
  return { nodes: n?.c ?? 0, edges: e?.c ?? 0 };
}

// Pulls the org's memory nodes most relevant to an intent: tokenizes the intent
// into words (>=4 chars), matches them against node label/body (ILIKE), ranks by
// number of distinct term hits, returns the top `limit`. Decisions/facts/preferences
// are the useful kinds for run context (identities/artifacts excluded by default).
export async function recallForIntent(
  db: DB, orgId: string, intent: string, limit = 5, opts: VisibilityOpts = {},
): Promise<Awaited<ReturnType<typeof listNodes>>> {
  const terms = [...new Set((intent.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []))].slice(0, 12);
  if (terms.length === 0) return [];
  const conds = [
    eq(memoryNodes.orgId, orgId),
    inArray(memoryNodes.kind, ["decision", "fact", "preference"]),
    or(...terms.flatMap((t) => [ilike(memoryNodes.label, `%${t}%`), ilike(memoryNodes.body, `%${t}%`)])),
  ];
  if (!opts.includeInactive) conds.push(eq(memoryNodes.status, "active"));
  const rows = await db.select().from(memoryNodes).where(and(...conds));
  const score = (n: { label: string; body: string }) =>
    terms.filter((t) => n.label.toLowerCase().includes(t) || (n.body ?? "").toLowerCase().includes(t)).length;
  return rows.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

// Formats recalled nodes into a compact context preamble for an agent prompt (or "").
export function formatRecall(nodes: Awaited<ReturnType<typeof listNodes>>): string {
  if (nodes.length === 0) return "";
  const lines = nodes.map((n) => `- (${n.kind}) ${n.label}${n.body ? `: ${n.body}` : ""}`);
  return `## Relevant prior context\n${lines.join("\n")}`;
}

export interface MemoryGraph { nodes: Awaited<ReturnType<typeof listNodes>>; edges: { id: string; fromId: string; toId: string; relation: string }[]; }

// Returns the org's nodes (optionally filtered) + the edges among those nodes.
export async function graph(db: DB, orgId: string, filter: { kind?: NodeKind; scope?: Scope } = {}, opts: VisibilityOpts = {}): Promise<MemoryGraph> {
  const nodes = await listNodes(db, orgId, filter, opts);
  const ids = new Set(nodes.map((n) => n.id));
  const all = await db.select().from(memoryEdges).where(eq(memoryEdges.orgId, orgId));
  const edges = all
    .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
    .map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation }));
  return { nodes, edges };
}

// supersedeNode: optimistic-locked versioning. Loads `oldId` (org-scoped); if its
// version !== expectedVersion throws "version conflict"; marks the old node
// `status="superseded"`, creates the replacement at version old.version+1, and links
// new→old with a `supersedes` edge. Cross-org (or missing) oldId → throws "not found".
export async function supersedeNode(
  db: DB,
  args: { orgId: string; oldId: string; expectedVersion: number; newNode: Omit<NewNode, "orgId"> },
) {
  const { orgId, oldId, expectedVersion, newNode } = args;
  const [old] = await db.select().from(memoryNodes).where(and(
    eq(memoryNodes.orgId, orgId), eq(memoryNodes.id, oldId),
  ));
  if (!old) throw new Error("not found");
  if (old.version !== expectedVersion) throw new Error("version conflict");
  await db.update(memoryNodes).set({ status: "superseded" }).where(and(
    eq(memoryNodes.orgId, orgId), eq(memoryNodes.id, oldId),
  ));
  const fresh = await createNode(db, { ...newNode, orgId, version: old.version + 1 });
  await createEdge(db, { orgId, fromId: fresh.id, toId: oldId, relation: "supersedes" });
  return fresh;
}

// invalidateNode marks a node inactive (hidden from recall/list/graph by default). Org-scoped.
export async function invalidateNode(db: DB, orgId: string, id: string) {
  await db.update(memoryNodes).set({ status: "invalidated" }).where(and(
    eq(memoryNodes.orgId, orgId), eq(memoryNodes.id, id),
  ));
}

// revalidateNode restores a node to active. Org-scoped.
export async function revalidateNode(db: DB, orgId: string, id: string) {
  await db.update(memoryNodes).set({ status: "active" }).where(and(
    eq(memoryNodes.orgId, orgId), eq(memoryNodes.id, id),
  ));
}

// addContradiction records that `fromId` contradicts `toId` via a `contradicts` edge. Org-scoped.
export async function addContradiction(db: DB, args: { orgId: string; fromId: string; toId: string }) {
  return createEdge(db, { ...args, relation: "contradicts" });
}
