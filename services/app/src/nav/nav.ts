import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { channels, threads, repos } from "../db/schema.js";

export function listChannels(db: DB, orgId: string) {
  return db.select().from(channels).where(eq(channels.orgId, orgId)).orderBy(asc(channels.name));
}

export function listThreads(db: DB, channelId: string) {
  return db.select().from(threads).where(eq(threads.channelId, channelId)).orderBy(desc(threads.createdAt));
}

export function listRepos(db: DB, orgId: string) {
  return db.select().from(repos).where(eq(repos.orgId, orgId)).orderBy(asc(repos.githubName));
}

export interface NewThread { orgId: string; channelId: string; title: string; repoId?: string | null; }

export async function createThread(db: DB, t: NewThread) {
  if (t.repoId) {
    const [r] = await db.select().from(repos).where(and(eq(repos.id, t.repoId), eq(repos.orgId, t.orgId)));
    if (!r) throw new Error(`repo not found in org: ${t.repoId}`);
  }
  const [thread] = await db.insert(threads).values({
    id: randomUUID(), orgId: t.orgId, channelId: t.channelId, title: t.title, repoId: t.repoId ?? null,
  }).returning();
  return thread;
}
