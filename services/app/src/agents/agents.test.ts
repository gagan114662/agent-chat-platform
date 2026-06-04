import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { resolveMention, isPermittedOnRepo } from "./agents.js";
import { orgs, workspaces, agents, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "Org" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "WS" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
  await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
});

describe("agents", () => {
  it("resolves a mention handle to an agent", async () => {
    const a = await resolveMention(h.db, "o1", "coder");
    expect(a?.id).toBe("a1");
  });
  it("returns undefined for unknown handle", async () => {
    expect(await resolveMention(h.db, "o1", "ghost")).toBeUndefined();
  });
  it("permits an agent on a repo in the same workspace", async () => {
    expect(await isPermittedOnRepo(h.db, "a1", "r1")).toBe(true);
  });
  it("denies an agent on a repo in a different workspace", async () => {
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o1", name: "WS2" });
    await h.db.insert(repos).values({ id: "r2", orgId: "o1", workspaceId: "w2", githubOwner: "o", githubName: "x", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
    expect(await isPermittedOnRepo(h.db, "a1", "r2")).toBe(false);
  });

  // #28: a shared agent runs on any repo in the SAME org (cross-team), unshared stays pinned.
  it("a shared agent is permitted on a repo in another workspace of the same org", async () => {
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o1", name: "WS2" });
    await h.db.insert(repos).values({ id: "r2", orgId: "o1", workspaceId: "w2", githubOwner: "o", githubName: "x", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
    // unshared → pinned to its home workspace, denied on w2's repo
    expect(await isPermittedOnRepo(h.db, "a1", "r2")).toBe(false);
    // flip shared on → now permitted cross-workspace within the org
    await h.db.update(agents).set({ shared: true }).where(eq(agents.id, "a1"));
    expect(await isPermittedOnRepo(h.db, "a1", "r2")).toBe(true);
  });

  it("a shared agent is NEVER permitted on a repo in another ORG", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "Org2" });
    await h.db.insert(workspaces).values({ id: "w9", orgId: "o2", name: "WS9" });
    await h.db.insert(repos).values({ id: "rOther", orgId: "o2", workspaceId: "w9", githubOwner: "o", githubName: "y", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
    await h.db.update(agents).set({ shared: true }).where(eq(agents.id, "a1"));
    expect(await isPermittedOnRepo(h.db, "a1", "rOther")).toBe(false);
  });
});
