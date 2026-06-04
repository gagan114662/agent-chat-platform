import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerDiffRoutes } from "./diff-routes.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_DIFF_TEST";

const SAMPLE_FILES = [
  {
    filename: "src/a.ts",
    additions: 2,
    deletions: 1,
    status: "modified",
    patch: "@@ -1,2 +1,3 @@\n context\n-removed\n+added\n+added2",
  },
];

async function seedRun(opts: { withPr: boolean }) {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: TOKEN_ENV,
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
  await h.db.insert(agents).values({ id: "aA", orgId: "oA", workspaceId: "wA", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  const { run } = await openTaskForMention(h.db, { orgId: "oA", threadId: "tA", intent: "ship", agentId: "aA", createdByKind: "human", createdById: "mA" });
  await transitionRun(h.db, run.id, "running", {}, "oA");
  if (opts.withPr) {
    await transitionRun(h.db, run.id, "held_for_human", { prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "abc" }, "oA");
  }
  return run;
}

function makeApp(calls: Array<[string, string, number]>) {
  const app = Fastify();
  registerDiffRoutes(app, {
    db: h.db,
    makeGitHub: () => ({
      getChangedFiles: async (o: string, r: string, n: number) => { calls.push([o, r, n]); return SAMPLE_FILES; },
    }),
  });
  return app;
}

describe("diff routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("GET /runs/:id/diff returns changed files with patch", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, number]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/diff`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([["acme", "widgets", 7]]);
    const files = res.json();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ filename: "src/a.ts", patch: SAMPLE_FILES[0].patch });
    await app.close();
  });

  it("cross-org diff access is denied (404)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, number]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/diff`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 404 when the run has no pr_number yet", async () => {
    const run = await seedRun({ withPr: false });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/diff`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const run = await seedRun({ withPr: true });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/diff`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    expect(res.body).not.toContain(TOKEN_ENV);
    await app.close();
  });
});
