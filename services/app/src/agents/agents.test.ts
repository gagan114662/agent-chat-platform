import { describe, it, expect, afterAll, beforeEach } from "vitest";
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
});
