import { and, desc, eq, ilike } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { messages, threads } from "../db/schema.js";

export interface SearchResult {
  messageId: string;
  threadId: string;
  threadTitle: string;
  body: string;
  kind: string;
  createdAt: Date;
}

export async function searchMessages(db: DB, orgId: string, q: string): Promise<SearchResult[]> {
  if (!q.trim()) return [];
  return db.select({
    messageId: messages.id,
    threadId: messages.threadId,
    threadTitle: threads.title,
    body: messages.body,
    kind: messages.kind,
    createdAt: messages.createdAt,
  })
    .from(messages)
    .innerJoin(threads, eq(messages.threadId, threads.id))
    .where(and(eq(messages.orgId, orgId), ilike(messages.body, `%${q}%`)))
    .orderBy(desc(messages.createdAt))
    .limit(50);
}
