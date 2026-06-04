import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { messages } from "../db/schema.js";

export interface NewMessage {
  orgId: string;
  threadId: string;
  authorKind: "human" | "agent";
  authorId: string;
  body: string;
  kind?: "chat" | "system" | "pr_card" | "plan_card";
  metadata?: Record<string, unknown>;
  id?: string;
}

export async function createMessage(db: DB, m: NewMessage) {
  const row = {
    id: m.id ?? randomUUID(),
    orgId: m.orgId,
    threadId: m.threadId,
    authorKind: m.authorKind,
    authorId: m.authorId,
    kind: m.kind ?? "chat",
    body: m.body,
    metadata: m.metadata ?? {},
  };
  const [inserted] = await db.insert(messages).values(row).onConflictDoNothing().returning();
  return inserted ?? row;
}

// #89 cursor pagination. Messages are totally ordered by the tuple (createdAt, id).
// `before`/`after` are message ids used as cursors:
//   - no cursor       → the newest `limit` messages
//   - before=<id>      → the `limit` messages strictly OLDER than that id
//   - after=<id>       → the `limit` messages strictly NEWER than that id
// Output is always ascending (oldest→newest) so today's behavior is preserved.
// A default limit bounds the result; with no params it returns the recent page
// in ascending order exactly as before (just capped). An unknown cursor id (e.g.
// from another org/thread) falls back to the default newest page.
export interface ListMessagesOpts { before?: string; after?: string; limit?: number; }

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function listMessages(db: DB, threadId: string, orgId: string, opts: ListMessagesOpts = {}) {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const base = and(eq(messages.threadId, threadId), eq(messages.orgId, orgId));

  // Resolve a cursor id to its (createdAt, id) tuple for stable keyset comparison.
  const cursorId = opts.after ?? opts.before;
  let cursor: { createdAt: Date; id: string } | undefined;
  if (cursorId) {
    const [c] = await db.select({ createdAt: messages.createdAt, id: messages.id }).from(messages)
      .where(and(base, eq(messages.id, cursorId)));
    cursor = c;
  }

  if (opts.after && cursor) {
    // strictly newer than the cursor: (createdAt > c.createdAt) OR (createdAt == c.createdAt AND id > c.id)
    const rows = await db.select().from(messages)
      .where(and(base, or(
        gt(messages.createdAt, cursor.createdAt),
        and(eq(messages.createdAt, cursor.createdAt), gt(messages.id, cursor.id)),
      )))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(limit);
    return rows;
  }

  // before-cursor (or no cursor): take the newest `limit` strictly older than the
  // cursor (or the newest overall), then re-sort ascending for output.
  const olderThan = opts.before && cursor
    ? and(base, or(
        lt(messages.createdAt, cursor.createdAt),
        and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
      ))
    : base;
  const rows = await db.select().from(messages)
    .where(olderThan)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  rows.sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime();
    return t !== 0 ? t : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return rows;
}
