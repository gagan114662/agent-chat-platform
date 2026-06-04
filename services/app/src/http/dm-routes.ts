import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { listPrincipals, getOrCreateDm, listDms } from "../dm/dm.js";
import { roleOf, can } from "../rbac/rbac.js";

export function registerDmRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/principals", async (req) => {
    const { orgId, userId } = actor(req);
    return listPrincipals(d.db, orgId, userId);
  });

  app.get("/dms", async (req) => listDms(d.db, actor(req).orgId));

  app.post("/dms", async (req, reply) => {
    const { peerKind, peerId } = req.body as { peerKind: "human" | "agent"; peerId: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "dm:start")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    try {
      const t = await getOrCreateDm(d.db, { orgId, peerKind, peerId });
      return reply.code(201).send(t);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
}
