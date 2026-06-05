import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, channels, repos, threadRepos, threads } from "../db/schema.js";
import { createThread } from "./nav.js";
import { addThreadRepo, listThreadRepos, removeThreadRepo, forkThread } from "./thread-repos.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
  await h.db.insert(channels).values([
    { id: "cA", orgId: "oA", workspaceId: "wA", name: "general" },
    { id: "cB", orgId: "oB", workspaceId: "wB", name: "general" },
  ]);
  await h.db.insert(repos).values([
    { id: "rA1", orgId: "oA", workspaceId: "wA", githubOwner: "o", githubName: "r1", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" },
    { id: "rA2", orgId: "oA", workspaceId: "wA", githubOwner: "o", githubName: "r2", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" },
    { id: "rB1", orgId: "oB", workspaceId: "wB", githubOwner: "o", githubName: "rb", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" },
  ]);
});

describe("thread_repos module", () => {
  it("createThread with a repoId mirrors a primary thread_repos row", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    expect(t.repoId).toBe("rA1");
    const rows = await listThreadRepos(h.db, "oA", t.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ repoId: "rA1", isPrimary: true });
  });

  it("createThread without a repo leaves no thread_repos rows", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "chatty" });
    expect(await listThreadRepos(h.db, "oA", t.id)).toEqual([]);
  });

  it("addThreadRepo adds a second repo (non-primary) → 2 rows, one primary", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2" });
    const rows = await listThreadRepos(h.db, "oA", t.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isPrimary).map((r) => r.repoId)).toEqual(["rA1"]);
  });

  it("setting a new primary flips the flag (only one primary)", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2", isPrimary: true });
    const rows = await listThreadRepos(h.db, "oA", t.id);
    const primaries = rows.filter((r) => r.isPrimary).map((r) => r.repoId);
    expect(primaries).toEqual(["rA2"]);
  });

  it("addThreadRepo is idempotent (re-adding same repo does not duplicate)", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2" });
    expect(await listThreadRepos(h.db, "oA", t.id)).toHaveLength(2);
  });

  it("addThreadRepo rejects a cross-org repo", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await expect(addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rB1" })).rejects.toThrow(/repo not found/);
  });

  it("addThreadRepo rejects a cross-org thread", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await expect(addThreadRepo(h.db, { orgId: "oB", threadId: t.id, repoId: "rB1" })).rejects.toThrow(/thread not found/);
  });

  it("removeThreadRepo is org-scoped (cross-org no-op, in-org removes)", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2" });
    expect(await removeThreadRepo(h.db, { orgId: "oB", threadId: t.id, repoId: "rA2" })).toBe(false);
    expect(await listThreadRepos(h.db, "oA", t.id)).toHaveLength(2);
    expect(await removeThreadRepo(h.db, { orgId: "oA", threadId: t.id, repoId: "rA2" })).toBe(true);
    expect(await listThreadRepos(h.db, "oA", t.id)).toHaveLength(1);
  });

  it("listThreadRepos is org-scoped (cross-org → empty)", async () => {
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    expect(await listThreadRepos(h.db, "oB", t.id)).toEqual([]);
  });

  it("forkThread creates a new thread with forkedFrom + the same repo set", async () => {
    const src = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "orig", repoId: "rA1" });
    await addThreadRepo(h.db, { orgId: "oA", threadId: src.id, repoId: "rA2" });

    const fork = await forkThread(h.db, { orgId: "oA", threadId: src.id, byId: "mA" });
    expect(fork.id).not.toBe(src.id);
    expect(fork.title).toBe("Fork of orig");
    expect(fork.channelId).toBe("cA");
    expect(fork.repoId).toBe("rA1"); // primary mirrored
    expect(fork.forkedFrom).toBe(src.id);

    const forkRepos = await listThreadRepos(h.db, "oA", fork.id);
    expect(forkRepos.map((r) => r.repoId).sort()).toEqual(["rA1", "rA2"]);
    expect(forkRepos.filter((r) => r.isPrimary).map((r) => r.repoId)).toEqual(["rA1"]);
  });

  it("forkThread is org-scoped (cross-org source → 404/throws, no fork)", async () => {
    const src = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "orig", repoId: "rA1" });
    await expect(forkThread(h.db, { orgId: "oB", threadId: src.id, byId: "mB" })).rejects.toThrow(/thread not found/);
    // no stray thread_repos rows created under oB
    const leaked = await h.db.select().from(threadRepos)
      .where(and(eq(threadRepos.orgId, "oB")));
    expect(leaked).toEqual([]);
  });

  it("forkThread of a repo-less thread copies an empty repo set", async () => {
    const src = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "chat" });
    const fork = await forkThread(h.db, { orgId: "oA", threadId: src.id, byId: "mA" });
    expect(fork.forkedFrom).toBe(src.id);
    expect(fork.repoId).toBeNull();
    expect(await listThreadRepos(h.db, "oA", fork.id)).toEqual([]);
  });
});

// quiet unused import lint
void threads;
