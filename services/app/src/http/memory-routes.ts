import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { createNode, listNodes, neighbors, searchNodes, counts, graph, recallForIntent, supersedeNode, invalidateNode, revalidateNode, addContradiction, deriveRelatedEdges, type NodeKind, type Scope } from "../memory/memory.js";
import { consolidate } from "../memory/dreaming.js";
import { roleOf, can } from "../rbac/rbac.js";

export function registerMemoryRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/memory", async (req) => {
    const { orgId } = actor(req);
    const { kind, scope, q } = req.query as { kind?: NodeKind; scope?: Scope; q?: string };
    if (q) return searchNodes(d.db, orgId, q);
    return listNodes(d.db, orgId, { kind, scope });
  });
  app.get("/memory/recall", async (req) => {
    const { orgId } = actor(req);
    const { q, limit } = req.query as { q?: string; limit?: string };
    if (!q) return [];
    const n = limit ? Number(limit) : NaN;
    return recallForIntent(d.db, orgId, q, Number.isFinite(n) && n > 0 ? n : 5);
  });
  app.get("/memory/stats", async (req) => counts(d.db, actor(req).orgId));
  app.get("/memory/graph", async (req) => {
    const { orgId } = actor(req);
    const { kind, scope } = req.query as { kind?: NodeKind; scope?: Scope };
    return graph(d.db, orgId, { kind, scope });
  });
  app.get("/memory/:id/neighbors", async (req) => neighbors(d.db, (req.params as { id: string }).id, actor(req).orgId));
  app.post("/memory/consolidate", async (req) => {
    const { orgId } = actor(req);
    return consolidate(d.db, orgId);
  });
  // #143: connect the graph — link nodes that share a meaningful label term with
  // `related` edges, so the explorer isn't scattered dots. Idempotent + bounded.
  app.post("/memory/derive-edges", async (req) => {
    const { orgId } = actor(req);
    return { created: await deriveRelatedEdges(d.db, orgId) };
  });
  app.post("/memory", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const b = req.body as { kind: NodeKind; label: string; body?: string; scope?: Scope; metadata?: Record<string, unknown>; derivedFrom?: string[] };
    if (!b?.kind || !b?.label) return reply.code(400).send({ error: "kind and label required" });
    // #29: creating an org-scoped memory node requires admin; narrower scopes are open to members.
    if (b.scope === "org" && !can(await roleOf(d.db, userId, orgId), "memory:write:org")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply.code(201).send(await createNode(d.db, { orgId, ...b }));
  });

  // #82: optimistic-locked supersede. 409 on stale version, 404 on missing/cross-org node.
  app.post("/memory/nodes/:id/supersede", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const b = req.body as { expectedVersion?: number; node?: { kind: NodeKind; label: string; body?: string; scope?: Scope; metadata?: Record<string, unknown>; derivedFrom?: string[] } };
    if (typeof b?.expectedVersion !== "number" || !b?.node?.kind || !b?.node?.label) {
      return reply.code(400).send({ error: "expectedVersion and node{kind,label} required" });
    }
    try {
      const fresh = await supersedeNode(d.db, { orgId, oldId: id, expectedVersion: b.expectedVersion, newNode: b.node });
      return reply.code(201).send(fresh);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "version conflict") return reply.code(409).send({ error: "version conflict" });
      if (msg === "not found") return reply.code(404).send({ error: "not found" });
      throw e;
    }
  });

  // #82: invalidate / revalidate. 404 when the node isn't in the actor's org.
  app.post("/memory/nodes/:id/invalidate", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const [node] = await listNodes(d.db, orgId, {}, { includeInactive: true }).then((ns) => ns.filter((n) => n.id === id));
    if (!node) return reply.code(404).send({ error: "not found" });
    await invalidateNode(d.db, orgId, id);
    return reply.code(200).send({ ok: true });
  });
  app.post("/memory/nodes/:id/revalidate", async (req, reply) => {
    const { orgId } = actor(req);
    const { id } = req.params as { id: string };
    const [node] = await listNodes(d.db, orgId, {}, { includeInactive: true }).then((ns) => ns.filter((n) => n.id === id));
    if (!node) return reply.code(404).send({ error: "not found" });
    await revalidateNode(d.db, orgId, id);
    return reply.code(200).send({ ok: true });
  });

  // #82: record a contradiction edge between two nodes.
  app.post("/memory/contradictions", async (req, reply) => {
    const { orgId } = actor(req);
    const b = req.body as { fromId?: string; toId?: string };
    if (!b?.fromId || !b?.toId) return reply.code(400).send({ error: "fromId and toId required" });
    await addContradiction(d.db, { orgId, fromId: b.fromId, toId: b.toId });
    return reply.code(201).send({ ok: true });
  });
}
