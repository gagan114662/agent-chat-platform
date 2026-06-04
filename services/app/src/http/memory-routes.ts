import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { createNode, listNodes, neighbors, searchNodes, counts, graph, recallForIntent, type NodeKind, type Scope } from "../memory/memory.js";
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
  app.post("/memory", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const b = req.body as { kind: NodeKind; label: string; body?: string; scope?: Scope; metadata?: Record<string, unknown> };
    if (!b?.kind || !b?.label) return reply.code(400).send({ error: "kind and label required" });
    // #29: creating an org-scoped memory node requires admin; narrower scopes are open to members.
    if (b.scope === "org" && !can(await roleOf(d.db, userId, orgId), "memory:write:org")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply.code(201).send(await createNode(d.db, { orgId, ...b }));
  });
}
