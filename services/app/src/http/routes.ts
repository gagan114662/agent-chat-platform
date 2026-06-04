import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import type postgres from "postgres";
import type { Client } from "@temporalio/client";
import { createMessage, listMessages } from "../chat/messages.js";
import { notify } from "../db/client.js";
import { handleMentions } from "../chat/handle-mentions.js";
import { THREAD_CHANNEL } from "../fusion/events.js";
import { threads } from "../db/schema.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";

export interface Deps { db: DB; sql: postgres.Sql; temporal: Client; sandboxUrl: string; }

export function registerRoutes(app: FastifyInstance, d: Deps) {
  app.get("/threads/:id/messages", async (req, reply) => {
    const { id: threadId } = req.params as { id: string };
    const { orgId } = actor(req);
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    const q = req.query as { before?: string; after?: string; limit?: string };
    const limit = q.limit !== undefined ? Number(q.limit) : undefined;
    return listMessages(d.db, threadId, orgId, {
      before: q.before,
      after: q.after,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.post("/threads/:id/messages", async (req, reply) => {
    const { id: threadId } = req.params as { id: string };
    const { body } = req.body as { body: string };
    const { orgId, userId } = actor(req);

    // #29: viewers are read-only — block message posts before any DB work.
    if (!can(await roleOf(d.db, userId, orgId), "message:post")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // Load the thread org-scoped FIRST so a foreign thread id can't be written to / mined for mentions.
    const [thread] = await d.db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
    if (!thread) return reply.code(404).send({ error: "thread not found" });

    const msg = await createMessage(d.db, { orgId, threadId, authorKind: "human", authorId: userId, body });
    await notify(d.sql, THREAD_CHANNEL, { threadId, message: msg });

    // #27: the mention loop is now the shared, depth-aware handleMentions. A human
    // author is depth 0 → children run at depth 1 (behavior identical to before).
    const started = await handleMentions(d, {
      orgId, threadId, body, authorKind: "human", authorId: userId, depth: 0,
    });
    return reply.code(201).send({ message: msg, startedRuns: started });
  });
}
