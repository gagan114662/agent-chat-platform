import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { resolveMention, isPermittedOnRepo, agentModelConfig, agentMcp } from "./agents.js";
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

  it("reads model/provider off a seeded agent's config (#58)", async () => {
    await h.db.insert(agents).values({
      id: "a-model", orgId: "o1", workspaceId: "w1", handle: "opus", displayName: "Opus",
      adapter: "claude-code", config: { model: "claude-sonnet-4-6", provider: "bedrock" },
    });
    const a = await resolveMention(h.db, "o1", "opus");
    expect(agentModelConfig(a)).toEqual({ model: "claude-sonnet-4-6", provider: "bedrock" });
  });

  it("an agent with empty config yields no model/provider (default, #58)", async () => {
    const a = await resolveMention(h.db, "o1", "coder");
    expect(agentModelConfig(a)).toEqual({});
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

describe("agentModelConfig (#58)", () => {
  it("returns {} for null/absent/empty config", () => {
    expect(agentModelConfig(null)).toEqual({});
    expect(agentModelConfig(undefined)).toEqual({});
    expect(agentModelConfig({})).toEqual({});
    expect(agentModelConfig({ config: {} })).toEqual({});
  });
  it("surfaces only string model/provider values", () => {
    expect(agentModelConfig({ config: { model: "m", provider: "bedrock" } })).toEqual({ model: "m", provider: "bedrock" });
    expect(agentModelConfig({ config: { model: "m" } })).toEqual({ model: "m" });
  });
  it("ignores non-string / empty values (no argv/env injection from a malformed config)", () => {
    expect(agentModelConfig({ config: { model: 123, provider: ["x"] } })).toEqual({});
    expect(agentModelConfig({ config: { model: "", provider: "" } })).toEqual({});
    expect(agentModelConfig({ config: "not-an-object" })).toEqual({});
  });
});

describe("agentMcp (#57)", () => {
  it("returns undefined for null/absent/empty/non-array config", () => {
    expect(agentMcp(null)).toBeUndefined();
    expect(agentMcp(undefined)).toBeUndefined();
    expect(agentMcp({})).toBeUndefined();
    expect(agentMcp({ config: {} })).toBeUndefined();
    expect(agentMcp({ config: { mcpServers: "filesystem" } })).toBeUndefined();
    expect(agentMcp({ config: "not-an-object" })).toBeUndefined();
  });
  it("surfaces a non-empty array of catalog names", () => {
    expect(agentMcp({ config: { mcpServers: ["filesystem", "git"] } })).toEqual(["filesystem", "git"]);
  });
  it("filters non-string / empty entries; undefined when none remain", () => {
    expect(agentMcp({ config: { mcpServers: ["filesystem", 123, "", null] } })).toEqual(["filesystem"]);
    expect(agentMcp({ config: { mcpServers: [123, ""] } })).toBeUndefined();
    expect(agentMcp({ config: { mcpServers: [] } })).toBeUndefined();
  });
});
