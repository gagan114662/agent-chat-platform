import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { repos, threads, threadRepos } from "../db/schema.js";

// #75 thread_repos: a thread can reference many repos, exactly one of which is the
// primary. `threads.repoId` stays the single/primary value (back-compat, and the
// fusion run dispatch still uses it) and is mirrored here. Every helper is
// org-scoped — a cross-org thread or repo is invisible (callers map to 404/no-op).

export interface AddThreadRepoInput {
  orgId: string;
  threadId: string;
  repoId: string;
  isPrimary?: boolean;
}

// addThreadRepo attaches a repo to a thread (org-scoped: both the thread and repo
// must be in the org). Idempotent on (orgId, threadId, repoId). When `isPrimary`
// is set, all other rows for the thread are demoted so exactly one primary remains.
export async function addThreadRepo(db: DB, input: AddThreadRepoInput) {
  const { orgId, threadId, repoId, isPrimary = false } = input;
  const [thread] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
  if (!thread) throw new Error(`thread not found in org: ${threadId}`);
  const [repo] = await db.select().from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.orgId, orgId)));
  if (!repo) throw new Error(`repo not found in org: ${repoId}`);

  if (isPrimary) {
    await db.update(threadRepos).set({ isPrimary: false })
      .where(and(eq(threadRepos.orgId, orgId), eq(threadRepos.threadId, threadId)));
  }
  await db.insert(threadRepos)
    .values({ orgId, threadId, repoId, isPrimary })
    .onConflictDoUpdate({
      target: [threadRepos.orgId, threadRepos.threadId, threadRepos.repoId],
      set: { isPrimary },
    });
  // keep threads.repoId in sync with the primary (back-compat single repo)
  if (isPrimary) {
    await db.update(threads).set({ repoId })
      .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
  }
  const [row] = await db.select().from(threadRepos)
    .where(and(
      eq(threadRepos.orgId, orgId),
      eq(threadRepos.threadId, threadId),
      eq(threadRepos.repoId, repoId),
    ));
  return row;
}

// listThreadRepos returns a thread's repo set (org-scoped), primary first then by
// repoId. A cross-org thread id yields no rows.
export function listThreadRepos(db: DB, orgId: string, threadId: string) {
  return db.select().from(threadRepos)
    .where(and(eq(threadRepos.orgId, orgId), eq(threadRepos.threadId, threadId)))
    .orderBy(desc(threadRepos.isPrimary), asc(threadRepos.repoId));
}

// removeThreadRepo detaches a repo from a thread (org-scoped). Returns true if a
// row was removed, false otherwise (unknown / cross-org → no-op).
export async function removeThreadRepo(
  db: DB,
  input: { orgId: string; threadId: string; repoId: string },
): Promise<boolean> {
  const removed = await db.delete(threadRepos)
    .where(and(
      eq(threadRepos.orgId, input.orgId),
      eq(threadRepos.threadId, input.threadId),
      eq(threadRepos.repoId, input.repoId),
    ))
    .returning({ repoId: threadRepos.repoId });
  return removed.length > 0;
}

// forkThread shallow-forks a thread: a new thread in the same channel (title
// "Fork of <title>", repoId = the source primary, forkedFrom = source id) that
// copies the source's thread_repos rows. Message history is NOT copied. Org-scoped
// — a cross-org source id throws (callers map to 404) and creates nothing.
export async function forkThread(
  db: DB,
  input: { orgId: string; threadId: string; byId: string },
) {
  const { orgId, threadId } = input;
  const [src] = await db.select().from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.orgId, orgId)));
  if (!src) throw new Error(`thread not found in org: ${threadId}`);

  const srcRepos = await db.select().from(threadRepos)
    .where(and(eq(threadRepos.orgId, orgId), eq(threadRepos.threadId, threadId)));

  const [fork] = await db.insert(threads).values({
    id: randomUUID(),
    orgId,
    channelId: src.channelId,
    title: `Fork of ${src.title}`,
    repoId: src.repoId,
    kind: src.kind,
    dmPeerKind: src.dmPeerKind,
    dmPeerId: src.dmPeerId,
    forkedFrom: src.id,
  }).returning();

  if (srcRepos.length > 0) {
    await db.insert(threadRepos).values(
      srcRepos.map((r) => ({ orgId, threadId: fork.id, repoId: r.repoId, isPrimary: r.isPrimary })),
    ).onConflictDoNothing();
  }
  return fork;
}
