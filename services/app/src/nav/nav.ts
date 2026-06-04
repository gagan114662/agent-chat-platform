import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { channels, threads, repos, workspaces } from "../db/schema.js";

export function listChannels(db: DB, orgId: string) {
  return db.select().from(channels).where(eq(channels.orgId, orgId)).orderBy(asc(channels.name));
}

export function listThreads(db: DB, channelId: string, orgId: string) {
  return db.select().from(threads)
    .where(and(eq(threads.channelId, channelId), eq(threads.orgId, orgId)))
    .orderBy(desc(threads.createdAt));
}

export function listRepos(db: DB, orgId: string) {
  return db.select().from(repos).where(eq(repos.orgId, orgId)).orderBy(asc(repos.githubName));
}

export interface NewThread { orgId: string; channelId: string; title: string; repoId?: string | null; }

export async function createThread(db: DB, t: NewThread) {
  // Verify the target channel belongs to the actor's org (closes cross-tenant IDOR).
  const [ch] = await db.select().from(channels).where(and(eq(channels.id, t.channelId), eq(channels.orgId, t.orgId)));
  if (!ch) throw new Error(`channel not found in org: ${t.channelId}`);
  if (t.repoId) {
    const [r] = await db.select().from(repos).where(and(eq(repos.id, t.repoId), eq(repos.orgId, t.orgId)));
    if (!r) throw new Error(`repo not found in org: ${t.repoId}`);
  }
  const [thread] = await db.insert(threads).values({
    id: randomUUID(), orgId: t.orgId, channelId: t.channelId, title: t.title, repoId: t.repoId ?? null,
  }).returning();
  return thread;
}

export async function createChannel(db: DB, input: { orgId: string; name: string }) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.orgId, input.orgId)).limit(1);
  if (!ws) throw new Error(`no workspace for org: ${input.orgId}`);
  const [c] = await db.insert(channels).values({
    id: randomUUID(), orgId: input.orgId, workspaceId: ws.id, name: input.name,
  }).returning();
  return c;
}
