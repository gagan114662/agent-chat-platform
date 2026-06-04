import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { listChannels, listThreads, listRepos, createThread, createChannel } from "../nav/nav.js";
import { searchMessages } from "../search/search.js";
import { roleOf, can } from "../rbac/rbac.js";

export function registerNavRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/channels", async (req) => listChannels(d.db, actor(req).orgId));

  app.get("/channels/:id/threads", async (req) => {
    const { id } = req.params as { id: string };
    return listThreads(d.db, id, actor(req).orgId);
  });

  app.post("/channels/:id/threads", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, repoId } = req.body as { title: string; repoId?: string };
    const { orgId } = actor(req);
    try {
      const thread = await createThread(d.db, { orgId, channelId: id, title, repoId });
      return reply.code(201).send(thread);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/repos", async (req) => listRepos(d.db, actor(req).orgId));

  app.post("/channels", async (req, reply) => {
    const { name } = req.body as { name: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "channel:create")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    const channel = await createChannel(d.db, { orgId, name: name.trim() });
    return reply.code(201).send(channel);
  });

  app.get("/search", async (req) => {
    const q = (req.query as { q?: string }).q ?? "";
    return searchMessages(d.db, actor(req).orgId, q);
  });
}
