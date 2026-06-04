import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerCommentSyncRoutes } from "./comment-sync-routes.js";
import { listMessages } from "../chat/messages.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_COMMENT_SYNC_TEST";

const SAMPLE_COMMENTS = [
  { id: 101, body: "fix this", user: "alice", path: "src/a.ts", line: 12 },
  { id: 102, body: "nit", user: "bob", path: undefined, line: undefined },
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
  registerCommentSyncRoutes(app, {
    db: h.db,
    sql: h.sql,
    makeGitHub: () => ({
      listReviewComments: async (o: string, r: string, n: number) => { calls.push([o, r, n]); return SAMPLE_COMMENTS; },
    }),
  });
  return app;
}

describe("comment sync routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("POST /runs/:id/sync-comments pulls review comments into the thread (idempotent on re-sync)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, number]> = [];
    const app = makeApp(calls);

    // First sync posts both comments.
    const res1 = await app.inject({ method: "POST", url: `/runs/${run.id}/sync-comments`, headers: { "x-org-id": "oA" } });
    expect(res1.statusCode).toBe(200);
    expect(res1.json()).toEqual({ synced: 2 });
    expect(calls).toEqual([["acme", "widgets", 7]]);

    const msgs = await listMessages(h.db, "tA", "oA");
    const systemMsgs = msgs.filter((m) => m.kind === "system" && m.body.includes("💬"));
    expect(systemMsgs).toHaveLength(2);
    expect(systemMsgs.some((m) => m.body.includes("💬 alice on src/a.ts:12: fix this"))).toBe(true);
    expect(systemMsgs.some((m) => m.body.includes("💬 bob: nit"))).toBe(true);

    // Second sync is idempotent: deterministic ids dedupe, no new messages.
    const res2 = await app.inject({ method: "POST", url: `/runs/${run.id}/sync-comments`, headers: { "x-org-id": "oA" } });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ synced: 0 });

    const after = await listMessages(h.db, "tA", "oA");
    expect(after.filter((m) => m.kind === "system" && m.body.includes("💬"))).toHaveLength(2);

    await app.close();
  });

  it("cross-org sync access is denied (404)", async () => {
    const run = await seedRun({ withPr: true });
    const calls: Array<[string, string, number]> = [];
    const app = makeApp(calls);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/sync-comments`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("returns 404 when the run has no pr_number yet", async () => {
    const run = await seedRun({ withPr: false });
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/sync-comments`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const run = await seedRun({ withPr: true });
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/sync-comments`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    expect(res.body).not.toContain(TOKEN_ENV);
    await app.close();
  });
});
