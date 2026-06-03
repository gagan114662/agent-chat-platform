import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { messages } from "../db/schema.js";

export interface NewMessage {
  orgId: string;
  threadId: string;
  authorKind: "human" | "agent";
  authorId: string;
  body: string;
  kind?: "chat" | "system" | "pr_card";
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

export async function listMessages(db: DB, threadId: string) {
  return db.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(asc(messages.createdAt), asc(messages.id));
}
