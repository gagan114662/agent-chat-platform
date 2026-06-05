import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerIntegrationRoutes } from "../http/integration-routes.js";
import { listMessages } from "../chat/messages.js";
import { orgs, workspaces, channels, repos, tasks, threads } from "../db/schema.js";
import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";
import type { ReviewComment } from "@acp/orchestrator/github/github-service.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_FROM_PR_TEST";

const FILES: ChangedFile[] = [
  { filename: "src/login.ts", additions: 12, deletions: 3, status: "modified", patch: "@@" },
  { filename: "src/login.test.ts", additions: 40, deletions: 0, status: "added" },
];
const COMMENTS: ReviewComment[] = [
  { id: 201, body: "handle empty password", user: "alice", path: "src/login.ts", line: 8 },
  { id: 202, body: "nit: rename", user: "bob" },
];

interface Calls { changed: Array<[string, string, number]>; comments: Array<[string, string, number]>; }

function makeApp(calls: Calls) {
  const app = Fastify();
  registerIntegrationRoutes(app, {
    db: h.db,
    makeGitHub: () => ({
      listIssues: async () => [],
      getChangedFiles: async (o: string, r: string, n: number) => { calls.changed.push([o, r, n]); return FILES; },
      listReviewComments: async (o: string, r: string, n: number) => { calls.comments.push([o, r, n]); return COMMENTS; },
    }),
  });
  return app;
}

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: TOKEN_ENV,
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
}

const body = (over: Record<string, unknown> = {}) => ({ channelId: "cA", owner: "acme", repo: "widgets", prNumber: 7, ...over });

describe("POST /integrations/github/from-pr (#78)", () => {
  beforeEach(async () => { await seed(); process.env[TOKEN_ENV] = "tok"; });

  it("creates a thread+task seeded with the PR's diff + review comments", async () => {
    const calls: Calls = { changed: [], comments: [] };
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/from-pr",
      headers: { "x-org-id": "oA" }, payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const { threadId, taskId } = res.json();
    expect(taskId).toBe("from-pr:acme/widgets#7");
    expect(calls.changed).toEqual([["acme", "widgets", 7]]);
    expect(calls.comments).toEqual([["acme", "widgets", 7]]);

    // Thread is created in the channel, wired to the repo.
    const [thread] = await h.db.select().from(threads).where(eq(threads.id, threadId));
    expect(thread.channelId).toBe("cA");
    expect(thread.repoId).toBe("rA");
    expect(thread.title).toBe("PR #7 acme/widgets");

    // Task is the deterministic id, on the thread.
    const [task] = await h.db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.orgId, "oA")));
    expect(task.threadId).toBe(threadId);

    // The PR's changed files + review comments are seeded as pr_card messages.
    const msgs = await listMessages(h.db, threadId, "oA");
    const cards = msgs.filter((m) => m.kind === "pr_card");
    expect(cards).toHaveLength(3); // 1 files summary + 2 comments
    const fileCard = cards.find((m) => m.body.includes("changed file"));
    expect(fileCard!.body).toContain("src/login.ts");
    expect(fileCard!.body).toContain("src/login.test.ts");
    expect(cards.some((m) => m.body.includes("💬 alice on src/login.ts:8: handle empty password"))).toBe(true);
    expect(cards.some((m) => m.body.includes("💬 bob: nit: rename"))).toBe(true);
    await app.close();
  });

  it("is idempotent: re-run creates no duplicate task/thread/messages", async () => {
    const calls: Calls = { changed: [], comments: [] };
    const app = makeApp(calls);
    const first = await app.inject({
      method: "POST", url: "/integrations/github/from-pr",
      headers: { "x-org-id": "oA" }, payload: body(),
    });
    const { threadId } = first.json();

    const second = await app.inject({
      method: "POST", url: "/integrations/github/from-pr",
      headers: { "x-org-id": "oA" }, payload: body(),
    });
    expect(second.statusCode).toBe(200);
    // Same thread + task on re-run.
    expect(second.json().threadId).toBe(threadId);
    expect(second.json().taskId).toBe("from-pr:acme/widgets#7");

    // No duplicate tasks, threads, or messages.
    expect(await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"))).toHaveLength(1);
    expect(await h.db.select().from(threads).where(eq(threads.orgId, "oA"))).toHaveLength(1);
    const cards = (await listMessages(h.db, threadId, "oA")).filter((m) => m.kind === "pr_card");
    expect(cards).toHaveLength(3);
    await app.close();
  });

  it("cross-org repo → 404 (nothing created)", async () => {
    const calls: Calls = { changed: [], comments: [] };
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/from-pr",
      headers: { "x-org-id": "oB" }, payload: body(),
    });
    expect(res.statusCode).toBe(404);
    expect(calls.changed).toEqual([]);
    expect(await h.db.select().from(tasks).where(eq(tasks.orgId, "oB"))).toHaveLength(0);
    await app.close();
  });

  it("no token → 400 (no env-var-name leak)", async () => {
    delete process.env[TOKEN_ENV];
    const calls: Calls = { changed: [], comments: [] };
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/integrations/github/from-pr",
      headers: { "x-org-id": "oA" }, payload: body(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "repo token not configured" });
    expect(res.body).not.toContain(TOKEN_ENV);
    expect(calls.changed).toEqual([]);
    await app.close();
  });
});
