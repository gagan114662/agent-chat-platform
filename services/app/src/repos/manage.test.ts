import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, repos, goals } from "../db/schema.js";
import { connectRepo, ingestIssues, RepoError, type IssueFetcher } from "./manage.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  process.env.E2E_GITHUB_TOKEN = "tok"; // the default token env connectRepo validates
});

describe("connectRepo (#139)", () => {
  it("connects a repo and marks it production → plan-first", async () => {
    const r = await connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "gagan114662", githubName: "agent-chat-platform" });
    expect(r.githubName).toBe("agent-chat-platform");
    expect(r.production).toBe(true);
    expect(r.planMode).toBe(true); // production → human gate on merge
    expect(r.tokenEnvVar).toBe("E2E_GITHUB_TOKEN");
  });

  it("is idempotent — re-connecting returns the same repo", async () => {
    const a = await connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y" });
    const b = await connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y" });
    expect(a.id).toBe(b.id);
    expect((await h.db.select().from(repos).where(eq(repos.orgId, "o1")))).toHaveLength(1);
  });

  it("rejects when the token env var is absent", async () => {
    await expect(connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y", tokenEnvVar: "NOPE_MISSING" }))
      .rejects.toThrow(RepoError);
  });
});

describe("ingestIssues (#139)", () => {
  const fetcher: IssueFetcher = async () => ([
    { number: 7, title: "Add dark mode", body: "make it themable" },
    { number: 8, title: "Fix login", body: null },
  ]);

  it("creates one goal per open issue (titled #n …), excluding none here", async () => {
    const r = await connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y" });
    const out = await ingestIssues(h.db, { orgId: "o1", repoId: r.id, byId: "m1", fetch: fetcher });
    expect(out.created).toHaveLength(2);
    const gs = await h.db.select().from(goals).where(eq(goals.orgId, "o1"));
    expect(gs.map((g) => g.title).sort()).toEqual(["#7 Add dark mode", "#8 Fix login"]);
    expect(gs.find((g) => g.title === "#7 Add dark mode")?.criteria).toBe("make it themable");
  });

  it("is idempotent — re-ingest skips issues already a goal", async () => {
    const r = await connectRepo(h.db, { orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y" });
    await ingestIssues(h.db, { orgId: "o1", repoId: r.id, byId: "m1", fetch: fetcher });
    const again = await ingestIssues(h.db, { orgId: "o1", repoId: r.id, byId: "m1", fetch: fetcher });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toBe(2);
  });
});
