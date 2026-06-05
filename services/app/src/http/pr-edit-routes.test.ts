import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerPrEditRoutes } from "./pr-edit-routes.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_PR_EDIT_TEST";

type UpdateCall = { owner: string; repo: string; prNumber: number; patch: { title?: string; body?: string; base?: string } };

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

function makeApp(calls: UpdateCall[]) {
  const app = Fastify();
  registerPrEditRoutes(app, {
    db: h.db,
    makeGitHub: () => ({
      updatePr: async (owner: string, repo: string, prNumber: number, patch) => {
        calls.push({ owner, repo, prNumber, patch });
      },
      getPr: async () => ({ title: "current title", body: "current body", base: "main" }),
    }),
  });
  return app;
}

describe("pr edit routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("POST /runs/:id/update-pr updates the PR with only the provided fields", async () => {
    const run = await seedRun({ withPr: true });
    const calls: UpdateCall[] = [];
    const app = makeApp(calls);

    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/update-pr`,
      headers: { "x-org-id": "oA", "content-type": "application/json" },
      payload: { title: "new" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ owner: "acme", repo: "widgets", prNumber: 7, patch: { title: "new" } }]);

    await app.close();
  });

  it("cross-org access is denied (404)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: UpdateCall[] = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/update-pr`,
      headers: { "x-org-id": "oB", "content-type": "application/json" },
      payload: { title: "new" },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 404 when the run has no pr_number yet", async () => {
    const run = await seedRun({ withPr: false });
    const calls: UpdateCall[] = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/update-pr`,
      headers: { "x-org-id": "oA", "content-type": "application/json" },
      payload: { title: "new" },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const run = await seedRun({ withPr: true });
    const calls: UpdateCall[] = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/update-pr`,
      headers: { "x-org-id": "oA", "content-type": "application/json" },
      payload: { title: "new" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    expect(res.body).not.toContain(TOKEN_ENV);
    expect(calls).toEqual([]);
    await app.close();
  });
});
