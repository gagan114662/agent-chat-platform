import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { addThreadRepo, listThreadRepos, removeThreadRepo, forkThread } from "../nav/thread-repos.js";

// #75 multi-repo per thread + fork. All routes are org-scoped via actor(req).orgId;
// a cross-org thread or repo is invisible → 404. forkThread is a shallow fork
// (repo set + wiring + forkedFrom marker, NOT message history).
export function registerThreadReposRoutes(app: FastifyInstance, d: { db: DB }) {
  // Add a repo to a thread. `thread not found` / `repo not found` (cross-org or
  // unknown) → 404; setting isPrimary flips the primary flag for the thread.
  app.post("/threads/:id/repos", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId } = actor(req);
    const { repoId, isPrimary } = (req.body ?? {}) as { repoId?: string; isPrimary?: boolean };
    if (!repoId?.trim()) return reply.code(400).send({ error: "repoId required" });
    try {
      const row = await addThreadRepo(d.db, { orgId, threadId: id, repoId, isPrimary });
      return reply.code(201).send(row);
    } catch (e) {
      const msg = (e as Error).message;
      if (/not found/.test(msg)) return reply.code(404).send({ error: msg });
      return reply.code(400).send({ error: msg });
    }
  });

  // List a thread's repos (org-scoped; cross-org → empty array).
  app.get("/threads/:id/repos", async (req) => {
    const { id } = req.params as { id: string };
    return listThreadRepos(d.db, actor(req).orgId, id);
  });

  // Remove a repo from a thread (org-scoped). Unknown / cross-org → 404 (no-op).
  app.delete("/threads/:id/repos/:repoId", async (req, reply) => {
    const { id, repoId } = req.params as { id: string; repoId: string };
    const ok = await removeThreadRepo(d.db, { orgId: actor(req).orgId, threadId: id, repoId });
    if (!ok) return reply.code(404).send({ error: "thread repo not found" });
    return reply.code(204).send();
  });

  // Fork a thread (shallow): a new thread copying the repo set + forkedFrom marker.
  // Cross-org / unknown source → 404.
  app.post("/threads/:id/fork", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    try {
      const fork = await forkThread(d.db, { orgId, threadId: id, byId: userId });
      return reply.code(201).send(fork);
    } catch (e) {
      const msg = (e as Error).message;
      if (/not found/.test(msg)) return reply.code(404).send({ error: msg });
      return reply.code(400).send({ error: msg });
    }
  });
}
