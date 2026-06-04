import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerFileRoutes } from "./file-routes.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_FILE_TEST";

const SAMPLE = { content: "# Hello\n\nworld\n", encoding: "utf8" as const, size: 14 };

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

function makeApp(calls: Array<[string, string, string, string]>) {
  const app = Fastify();
  registerFileRoutes(app, {
    db: h.db,
    makeGitHub: () => ({
      getFileContent: async (o: string, r: string, ref: string, p: string) => { calls.push([o, r, ref, p]); return SAMPLE; },
    }),
  });
  return app;
}

describe("file routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("GET /runs/:id/file returns file content for the org owner", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, string, string]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=README.md`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([["acme", "widgets", "abc", "README.md"]]);
    expect(res.json()).toEqual(SAMPLE);
    await app.close();
  });

  it("cross-org file access is denied (404)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, string, string]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=README.md`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 400 when no path is given", async () => {
    const run = await seedRun({ withPr: true });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects a path containing .. (traversal) with 400", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, string, string]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=${encodeURIComponent("../secret")}`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("rejects an absolute path with 400", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, string, string]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=${encodeURIComponent("/etc/passwd")}`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 404 when the run has no commitSha yet", async () => {
    const run = await seedRun({ withPr: false });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=README.md`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const run = await seedRun({ withPr: true });
    const app = makeApp([]);
    const res = await app.inject({ method: "GET", url: `/runs/${run.id}/file?path=README.md`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(TOKEN_ENV);
    await app.close();
  });
});
