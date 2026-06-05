import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { listAudit, verifyChain } from "../audit/audit-log.js";
import { authorize, type ActorRole } from "../audit/policy.js";

// #150.3 audit + per-action authz routes. The compliance log is admin-only.
export function registerAuditRoutes(app: FastifyInstance, d: { db: DB }) {
  // The org's audit trail (newest first) — admin-gated.
  app.get("/audit", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) return reply.code(403).send({ error: "forbidden" });
    return reply.code(200).send({ entries: await listAudit(d.db, orgId, 200) });
  });

  // Verify the hash chain is intact (tamper-evidence check).
  app.get("/audit/verify", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) return reply.code(403).send({ error: "forbidden" });
    return reply.code(200).send(await verifyChain(d.db, orgId));
  });

  // Pre-flight a per-action authorization decision (the zero-trust policy hook) —
  // e.g. the UI or an integration can ask "may a <role> do <action>?" before acting.
  app.post("/authz", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const body = (req.body ?? {}) as { role?: ActorRole; action?: string; resource?: string; amountCents?: number; production?: boolean };
    if (!body.action) return reply.code(400).send({ error: "action required" });
    const role = (body.role ?? (await roleOf(d.db, userId, orgId))) as ActorRole;
    return reply.code(200).send(authorize({ role, action: body.action, resource: body.resource, amountCents: body.amountCents, production: body.production }));
  });
}
