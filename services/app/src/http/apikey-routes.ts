import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { issueApiKey, listApiKeys, revokeApiKey, type Scopes } from "../auth/api-keys.js";
import { apiKeys } from "../db/schema.js";

// #83 api-key management routes. Issue/revoke are admin-gated (`apikey:manage`);
// all operations are org-scoped (a key from another org is not-found → 404, never
// 403, since the actor IS an admin in their own org). POST returns the plaintext
// key ONCE — it is never retrievable again (only the hash is stored).
export function registerApiKeyRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/api-keys", async (req) => listApiKeys(d.db, actor(req).orgId));

  app.post("/api-keys", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "apikey:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { name, scopes } = req.body as { name?: string; scopes?: Scopes };
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    const issued = await issueApiKey(d.db, { orgId, name: name.trim(), scopes, userId });
    // The plaintext `key` is returned ONCE here and never shown again.
    return reply.code(201).send({ ...issued, note: "Store this key now — it will not be shown again." });
  });

  app.delete("/api-keys/:id", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "apikey:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    // Cross-org or unknown id → 404 (org-scoped; never reveal/affect another org's key).
    const [row] = await d.db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, orgId)));
    if (!row) return reply.code(404).send({ error: "api key not found" });
    await revokeApiKey(d.db, { orgId, id });
    return reply.code(204).send();
  });
}
