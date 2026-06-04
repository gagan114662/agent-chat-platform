import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerIntegrationRoutes } from "./integration-routes.js";
import type { LinearClient, LinearIssue } from "../integrations/linear.js";
import type { GitHubIssue } from "@acp/orchestrator/github/github-service.js";
import { orgs, workspaces, channels, threads, repos, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const ISSUES: LinearIssue[] = [
  { id: "i1", identifier: "ENG-1", title: "First", state: "Todo", url: "https://linear.app/i1" },
  { id: "i2", identifier: "ENG-2", title: "Second", state: "Done", url: "https://linear.app/i2" },
];

function fakeLinear(issues: LinearIssue[]): LinearClient {
  return { listIssues: async () => issues };
}

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T" });
}

function makeApp() {
  const app = Fastify();
  registerIntegrationRoutes(app, { db: h.db, makeLinear: () => fakeLinear(ISSUES) });
  return app;
}

describe("integration routes — Linear", () => {
  beforeEach(async () => { await seed(); process.env.LINEAR_API_KEY = "lk"; });

  it("POST /integrations/linear/import imports issues into org-scoped Tasks", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, ids: ["linear:i1", "linear:i2"] });
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);

    // Re-import is idempotent → 0 new.
    const res2 = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res2.json()).toEqual({ imported: 0, ids: [] });
    await app.close();
  });

  it("returns 400 when LINEAR_API_KEY is unset (no env-var-name leak)", async () => {
    delete process.env.LINEAR_API_KEY;
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("LINEAR_API_KEY");
    await app.close();
  });

  it("cross-org thread → 404", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oB" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(404);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oB"));
    expect(rows).toHaveLength(0);
    await app.close();
  });
});

const GH_TOKEN_ENV = "GH_TOKEN_INTEG_TEST";

// One PR mixed in — the route relies on listIssues already filtering PRs, so the
// fake mirrors that by returning only the two real issues.
const GH_ISSUES: GitHubIssue[] = [
  { number: 1, title: "Bug", body: "broken", state: "open", htmlUrl: "https://github.com/acme/widgets/issues/1" },
  { number: 3, title: "Feature", state: "open", htmlUrl: "https://github.com/acme/widgets/issues/3" },
];

function fakeGitHub(issues: GitHubIssue[], calls: string[][]) {
  return {
    listIssues: async (owner: string, repo: string) => { calls.push([owner, repo]); return issues; },
  };
}

async function seedRepo() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: GH_TOKEN_ENV,
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
}

function makeGhApp(calls: string[][]) {
  const app = Fastify();
  registerIntegrationRoutes(app, { db: h.db, makeGitHub: () => fakeGitHub(GH_ISSUES, calls) });
  return app;
}

describe("integration routes — GitHub", () => {
  beforeEach(async () => { await seedRepo(); process.env[GH_TOKEN_ENV] = "tok"; });

  it("imports issues (PRs filtered by listIssues) into org-scoped Tasks; idempotent", async () => {
    const calls: string[][] = [];
    const app = makeGhApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, ids: ["gh:acme/widgets#1", "gh:acme/widgets#3"] });
    expect(calls).toEqual([["acme", "widgets"]]);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);

    // Re-import → 0 new.
    const res2 = await app.inject({
      method: "POST", url: "/integrations/github/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res2.json()).toEqual({ imported: 0, ids: [] });
    await app.close();
  });

  it("returns 400 when the repo token env var is unset (no env-var-name leak)", async () => {
    delete process.env[GH_TOKEN_ENV];
    const calls: string[][] = [];
    const app = makeGhApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    expect(res.body).not.toContain(GH_TOKEN_ENV);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("cross-org thread → 404", async () => {
    const calls: string[][] = [];
    const app = makeGhApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/import",
      headers: { "x-org-id": "oB" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });
});
