import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { threads, members } from "../db/schema.js";
import { markRead, unreadCounts, mentionsInbox, runsInbox } from "../nav/read-state.js";

// Derive a member's @-mention handle from their displayName: lowercase and keep
// only the mention charset ([a-z0-9_-]), matching parseMentions. So a member
// "You" is mentioned as @you. Falls back to the userId when displayName yields
// an empty handle.
function handleFor(displayName: string, userId: string): string {
  const h = displayName.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return h || userId.toLowerCase();
}

// #61 notifications: per-user unread counts, mark-read, and mentions inbox.
export function registerNotifyRoutes(app: FastifyInstance, d: { db: DB }) {
  // Mark a thread read. Optional body { at } (ISO timestamp); defaults to now.
  // The thread must belong to the actor's org → 404 otherwise (no cross-tenant
  // read-state writes).
  app.post("/threads/:id/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { orgId, userId } = actor(req);
    const [t] = await d.db.select({ id: threads.id }).from(threads)
      .where(and(eq(threads.id, id), eq(threads.orgId, orgId)));
    if (!t) return reply.code(404).send({ error: "thread not found" });
    const body = (req.body ?? {}) as { at?: string };
    const at = body.at ? new Date(body.at) : undefined;
    await markRead(d.db, { orgId, userId, threadId: id, at });
    return reply.code(200).send({ ok: true });
  });

  // Unread counts for the actor's accessible threads in this org.
  app.get("/unreads", async (req) => {
    const { orgId, userId } = actor(req);
    return unreadCounts(d.db, orgId, userId);
  });

  // Mentions inbox: threads with an unread message mentioning the actor's handle.
  app.get("/inbox", async (req) => {
    const { orgId, userId } = actor(req);
    const [m] = await d.db.select({ displayName: members.displayName }).from(members)
      .where(and(eq(members.id, userId), eq(members.orgId, orgId)));
    const handle = handleFor(m?.displayName ?? userId, userId);
    // #107: Activity = your mentions + runs needing attention (failed/timed-out/
    // awaiting approval). Dedupe by thread; mentions first, then runs on other threads.
    const [mentions, runs] = await Promise.all([
      mentionsInbox(d.db, orgId, userId, handle),
      runsInbox(d.db, orgId),
    ]);
    const seen = new Set(mentions.map((i) => i.threadId));
    return [...mentions, ...runs.filter((i) => !seen.has(i.threadId))];
  });
}
