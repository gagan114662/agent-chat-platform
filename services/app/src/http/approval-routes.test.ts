import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerApprovalRoutes } from "./approval-routes.js";
import { listMessages } from "../chat/messages.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_APPROVAL_TEST";

async function seedHeldRun() {
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
  await transitionRun(h.db, run.id, "held_for_human", { prNumber: 7, prUrl: "https://gh/pr/7", commitSha: "abc" }, "oA");
  return run;
}

// Records merge calls instead of hitting GitHub.
function makeApp(merges: Array<[string, string, number]>) {
  const app = Fastify();
  registerApprovalRoutes(app, {
    db: h.db,
    makeGitHub: () => ({ merge: async (o: string, r: string, n: number) => { merges.push([o, r, n]); } }),
  });
  return app;
}

describe("approval routes", () => {
  beforeEach(async () => { process.env[TOKEN_ENV] = "tok"; await seedHeldRun(); });

  it("POST /runs/:id/approve merges via the injected client and flips run→merged", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const merges: Array<[string, string, number]> = [];
    const app = makeApp(merges);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("merged");
    expect(merges).toEqual([["acme", "widgets", 7]]);
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("merged");
    const msgs = await listMessages(h.db, "tA", "oA");
    expect(msgs.at(-1)?.body).toContain("approved & merged");
    await app.close();
  });

  it("cross-org approve is denied (404, no merge)", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const merges: Array<[string, string, number]> = [];
    const app = makeApp(merges);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    expect(merges).toEqual([]);
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("held_for_human");
    await app.close();
  });

  it("approve returns 400 when the repo token env var is unset", async () => {
    delete process.env[TOKEN_ENV];
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /runs/:id/decline posts a message and leaves the run held", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/decline`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("held_for_human");
    const msgs = await listMessages(h.db, "tA", "oA");
    expect(msgs.at(-1)?.body).toContain("declined");
    await app.close();
  });

  it("cross-org decline is denied (404)", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/decline`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
