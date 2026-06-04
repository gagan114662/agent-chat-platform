import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { listChannels, listThreads, listRepos, createThread, createChannel, renameChannel, setChannelArchived } from "../nav/nav.js";
import { searchMessages } from "../search/search.js";
import { roleOf, can } from "../rbac/rbac.js";

export function registerNavRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/channels", async (req) => {
    const includeArchived = (req.query as { includeArchived?: string }).includeArchived === "1";
    return listChannels(d.db, actor(req).orgId, { includeArchived });
  });

  // #89: rename a channel (admin-gated, org-scoped). Cross-org / unknown id → 404.
  app.patch("/channels/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "channel:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    const channel = await renameChannel(d.db, { orgId, channelId: id, name: name.trim() });
    if (!channel) return reply.code(404).send({ error: "channel not found" });
    return channel;
  });

  // #89: archive/unarchive a channel (admin-gated, org-scoped). Cross-org → 404.
  app.post("/channels/:id/archive", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { archived } = (req.body ?? {}) as { archived?: boolean };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "channel:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const channel = await setChannelArchived(d.db, { orgId, channelId: id, archived: archived ?? true });
    if (!channel) return reply.code(404).send({ error: "channel not found" });
    return channel;
  });

  app.get("/channels/:id/threads", async (req) => {
    const { id } = req.params as { id: string };
    return listThreads(d.db, id, actor(req).orgId);
  });

  app.post("/channels/:id/threads", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, repoId } = req.body as { title: string; repoId?: string };
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "thread:create")) {
      return reply.code(403).send({ error: "forbidden" });
    }
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
