import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { setAgentShared } from "../agents/agents.js";
import { roleOf } from "../rbac/rbac.js";

export function registerAgentRoutes(app: FastifyInstance, d: { db: DB }) {
  // #28: toggle whether an agent is shared org-wide (admin only, org-scoped).
  app.patch("/agents/:id/shared", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { shared } = req.body as { shared: boolean };
    const { orgId, userId } = actor(req);
    if ((await roleOf(d.db, userId, orgId)) !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (typeof shared !== "boolean") return reply.code(400).send({ error: "shared (boolean) required" });
    const agent = await setAgentShared(d.db, { orgId, agentId: id, shared });
    if (!agent) return reply.code(404).send({ error: "agent not found" });
    return reply.code(200).send(agent);
  });
}
