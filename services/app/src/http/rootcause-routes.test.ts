import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerRootCauseRoutes } from "./rootcause-routes.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_ROOTCAUSE_TEST";

const SAMPLE_FILES = [
  { filename: "src/auth.ts", additions: 3, deletions: 1, status: "modified", patch: "@@" },
  { filename: "README.md", additions: 500, deletions: 0, status: "modified", patch: "@@" },
];
const FAILURE = "FAIL src/auth.ts:42 — TypeError: token undefined";

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
    await transitionRun(h.db, run.id, "checks_failed", { prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "abc" }, "oA");
  }
  return run;
}

function makeApp(calls: string[]) {
  const app = Fastify();
  registerRootCauseRoutes(app, {
    db: h.db,
    makeGitHub: () => ({
      getChangedFiles: async (o: string, r: string, n: number) => { calls.push(`files:${o}/${r}#${n}`); return SAMPLE_FILES; },
      getCheckFailureContext: async (o: string, r: string, ref: string) => { calls.push(`fail:${o}/${r}@${ref}`); return FAILURE; },
    }),
  });
  return app;
}

describe("root-cause routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("GET /runs/:id/root-cause returns ranked suspects with the mentioned file first", async () => {
    const run = await seedRun({ withPr: true });
    const calls: string[] = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/root-cause`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(["files:acme/widgets#7", "fail:acme/widgets@abc"]);
    const body = res.json();
    expect(body.failure).toBe(FAILURE);
    expect(body.summary).toBe(`checks_failed: ${FAILURE}`);
    expect(body.suspects[0]).toMatchObject({ file: "src/auth.ts" });
    expect(body.suspects[0].reason).toContain("mentioned in CI failure");
    await app.close();
  });

  it("cross-org access is denied (404)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: string[] = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/root-cause`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 404 when the run has no PR/commit yet", async () => {
    const run = await seedRun({ withPr: false });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/root-cause`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const run = await seedRun({ withPr: true });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/root-cause`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    await app.close();
  });
});
