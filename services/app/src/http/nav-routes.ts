import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { listChannels, listThreads, listRepos, createThread } from "../nav/nav.js";

export function registerNavRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/channels", async (req) => listChannels(d.db, actor(req).orgId));

  app.get("/channels/:id/threads", async (req) => {
    const { id } = req.params as { id: string };
    return listThreads(d.db, id);
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
}
