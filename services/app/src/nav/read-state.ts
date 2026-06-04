import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { readState } from "../db/schema.js";

// #61 per-user read-state. Unread = messages with createdAt > lastReadAt. No
// read-state row for (orgId,userId,threadId) → every message is unread. All
// queries are org+user scoped.

export interface MarkReadInput {
  orgId: string;
  userId: string;
  threadId: string;
  at?: Date;
}

// Upsert the read marker for a thread (onConflict update lastReadAt).
export async function markRead(db: DB, m: MarkReadInput): Promise<void> {
  const at = m.at ?? new Date();
  await db.insert(readState)
    .values({ orgId: m.orgId, userId: m.userId, threadId: m.threadId, lastReadAt: at })
    .onConflictDoUpdate({
      target: [readState.orgId, readState.userId, readState.threadId],
      set: { lastReadAt: at },
    });
}

export interface UnreadCount { threadId: string; unread: number; }

// For the user's accessible threads in this org, count messages newer than the
// user's lastReadAt (no row → all messages count). Only threads with unread > 0
// are returned. The LEFT JOIN keys read_state by (org,user,thread) so the count
// is per-user.
export async function unreadCounts(db: DB, orgId: string, userId: string): Promise<UnreadCount[]> {
  const rows = await db.execute<{ thread_id: string; unread: string | number }>(sql`
    SELECT m.thread_id AS thread_id, COUNT(*)::int AS unread
    FROM messages m
    JOIN threads t ON t.id = m.thread_id AND t.org_id = ${orgId}
    LEFT JOIN read_state rs
      ON rs.org_id = ${orgId} AND rs.user_id = ${userId} AND rs.thread_id = m.thread_id
    WHERE m.org_id = ${orgId}
      AND m.created_at > COALESCE(rs.last_read_at, 'epoch'::timestamptz)
    GROUP BY m.thread_id
    HAVING COUNT(*) > 0
  `);
  return [...rows].map((r) => ({ threadId: r.thread_id, unread: Number(r.unread) }));
}

export interface InboxItem { threadId: string; title: string; latestAt: Date; }

// Threads where an unread message (createdAt > lastReadAt) mentions @<handle>
// (case-insensitive), most recent first. Org+user scoped.
export async function mentionsInbox(db: DB, orgId: string, userId: string, handle: string): Promise<InboxItem[]> {
  if (!handle.trim()) return [];
  const needle = `%@${handle}%`;
  const rows = await db.execute<{ thread_id: string; title: string; latest_at: Date }>(sql`
    SELECT m.thread_id AS thread_id, t.title AS title, MAX(m.created_at) AS latest_at
    FROM messages m
    JOIN threads t ON t.id = m.thread_id AND t.org_id = ${orgId}
    LEFT JOIN read_state rs
      ON rs.org_id = ${orgId} AND rs.user_id = ${userId} AND rs.thread_id = m.thread_id
    WHERE m.org_id = ${orgId}
      AND m.created_at > COALESCE(rs.last_read_at, 'epoch'::timestamptz)
      AND m.body ILIKE ${needle}
    GROUP BY m.thread_id, t.title
    ORDER BY MAX(m.created_at) DESC
  `);
  return [...rows].map((r) => ({ threadId: r.thread_id, title: r.title, latestAt: new Date(r.latest_at) }));
}
