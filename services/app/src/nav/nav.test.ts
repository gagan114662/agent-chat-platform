import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { listChannels, listThreads, listRepos, createThread } from "./nav.js";
import { orgs, workspaces, channels, threads, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
});

describe("nav", () => {
  it("lists channels and repos for an org", async () => {
    expect((await listChannels(h.db, "o1")).map((c) => c.name)).toEqual(["general"]);
    expect((await listRepos(h.db, "o1")).map((r) => r.id)).toEqual(["r1"]);
  });

  it("creates a thread (repo-bound) and lists it in the channel", async () => {
    const t = await createThread(h.db, { orgId: "o1", channelId: "c1", title: "fix login", repoId: "r1" });
    expect(t.title).toBe("fix login");
    expect(t.repoId).toBe("r1");
    const list = await listThreads(h.db, "c1");
    expect(list.map((x) => x.id)).toContain(t.id);
  });

  it("rejects a thread bound to a repo from another org", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(repos).values({ id: "r2", orgId: "o2", workspaceId: "w2", githubOwner: "o", githubName: "x", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
    await expect(createThread(h.db, { orgId: "o1", channelId: "c1", title: "x", repoId: "r2" })).rejects.toThrow(/repo not found/);
  });

  it("creates a thread with no repo", async () => {
    const t = await createThread(h.db, { orgId: "o1", channelId: "c1", title: "chatty" });
    expect(t.repoId).toBeNull();
  });
});
