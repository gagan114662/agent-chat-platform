import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAutonomyRoutes, runTickForAllOrgs } from "./autonomy-routes.js";
import type { StartRun } from "../autonomy/tick.js";
import { orgs, workspaces, channels, threads, repos, agents, goals, tasks, runs, incidents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// FAKE temporal: a throwing client proves the injected `start` is what dispatches (no live Temporal).
const temporalStub = { workflow: { start: async () => { throw new Error("temporal client must not be called"); } } } as any;

function makeApp(start: StartRun) {
  const app = Fastify();
  registerAutonomyRoutes(app, { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090", start });
  return app;
}
const hdr = (orgId: string) => ({ "x-org-id": orgId, "x-user-id": "m1", "content-type": "application/json" });

beforeEach(async () => {
  process.env.E2E_GITHUB_TOKEN = "tok";
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O B" }]);
  await h.db.insert(workspaces).values([{ id: "w1", orgId: "o1", name: "W" }, { id: "w2", orgId: "o2", name: "W B" }]);
  await h.db.insert(repos).values([
    { id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" },
    { id: "rb", orgId: "o2", workspaceId: "w2", githubOwner: "acme", githubName: "b", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" },
  ]);
  await h.db.insert(channels).values([{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }, { id: "c2", orgId: "o2", workspaceId: "w2", name: "general" }]);
  await h.db.insert(threads).values([
    { id: "t1", orgId: "o1", channelId: "c1", title: "T1", repoId: "r1" },
    { id: "tb", orgId: "o2", channelId: "c2", title: "TB", repoId: "rb" },
  ]);
  await h.db.insert(agents).values([
    { id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} },
  ]);
});

describe("autonomy routes", () => {
  it("POST /goals creates an org-scoped goal", async () => {
    const app = makeApp(vi.fn(async () => {}));
    const res = await app.inject({ method: "POST", url: "/goals", headers: hdr("o1"), payload: { title: "Launch", criteria: "a\nb" } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.orgId).toBe("o1");
    expect(body.state).toBe("open");
    expect(body.createdByKind).toBe("human");
    const [g] = await h.db.select().from(goals).where(eq(goals.id, body.id));
    expect(g.title).toBe("Launch");
    await app.close();
  });

  it("POST /goals/:id/decompose creates tasks from the goal", async () => {
    const app = makeApp(vi.fn(async () => {}));
    const created = await app.inject({ method: "POST", url: "/goals", headers: hdr("o1"), payload: { title: "Launch", criteria: "x\ny\nz" } });
    const goalId = created.json().id;
    const res = await app.inject({ method: "POST", url: `/goals/${goalId}/decompose`, headers: hdr("o1"), payload: { threadId: "t1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().taskIds.length).toBe(3);
    const t = await h.db.select().from(tasks).where(eq(tasks.orgId, "o1"));
    expect(t.length).toBe(3);
    await app.close();
  });

  it("POST /orgs/:orgId/tick dispatches ready tasks via the fake starter and returns the report", async () => {
    await h.db.insert(tasks).values([
      { id: "k1", orgId: "o1", threadId: "t1", title: "do k1", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" },
      { id: "k2", orgId: "o1", threadId: "t1", title: "do k2", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" },
    ]);
    const start = vi.fn(async () => {});
    const app = makeApp(start);
    const res = await app.inject({ method: "POST", url: "/orgs/o1/tick", headers: hdr("o1"), payload: { budgetMax: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().dispatched.length).toBe(2);
    expect(start).toHaveBeenCalledTimes(2);
    const pending = await h.db.select().from(runs).where(eq(runs.state, "pending"));
    expect(pending.length).toBe(2);
    await app.close();
  });

  it("POST /orgs/:orgId/tick for another org → 403 (cross-org)", async () => {
    await h.db.insert(tasks).values({ id: "bt", orgId: "o2", threadId: "tb", title: "bt", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    const start = vi.fn(async () => {});
    const app = makeApp(start);
    // actor in org o1 trying to tick org o2
    const res = await app.inject({ method: "POST", url: "/orgs/o2/tick", headers: hdr("o1"), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(start).not.toHaveBeenCalled();
    // org-B task untouched
    const [bt] = await h.db.select().from(tasks).where(eq(tasks.id, "bt"));
    expect(bt.state).toBe("open");
    await app.close();
  });
});

describe("alerts routes (#93)", () => {
  it("POST /orgs/:orgId/alerts/scan records new alerts and GET /orgs/:orgId/alerts lists them", async () => {
    // a failed run in org-A → one alert
    await h.db.insert(tasks).values({ id: "k1", orgId: "o1", threadId: "t1", title: "do k1", state: "in_progress", createdByKind: "agent", createdById: "planner" });
    await h.db.insert(runs).values({ id: "r-cf", orgId: "o1", taskId: "k1", state: "checks_failed", workflowId: "wf1" });
    const app = makeApp(vi.fn(async () => {}));

    const scan = await app.inject({ method: "POST", url: "/orgs/o1/alerts/scan", headers: hdr("o1"), payload: {} });
    expect(scan.statusCode).toBe(200);
    expect(scan.json().alerts).toBe(1);

    // idempotent: a second scan finds 0 new
    const scan2 = await app.inject({ method: "POST", url: "/orgs/o1/alerts/scan", headers: hdr("o1"), payload: {} });
    expect(scan2.json().alerts).toBe(0);

    const list = await app.inject({ method: "GET", url: "/orgs/o1/alerts", headers: hdr("o1") });
    expect(list.statusCode).toBe(200);
    const items = list.json().alerts;
    expect(items.length).toBe(1);
    expect(items[0].source).toBe("alert");
    await app.close();
  });

  it("POST /orgs/:orgId/alerts/scan for another org → 403 (cross-org)", async () => {
    const app = makeApp(vi.fn(async () => {}));
    const res = await app.inject({ method: "POST", url: "/orgs/o2/alerts/scan", headers: hdr("o1"), payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /orgs/:orgId/alerts for another org → 403 (cross-org)", async () => {
    const app = makeApp(vi.fn(async () => {}));
    const res = await app.inject({ method: "GET", url: "/orgs/o2/alerts", headers: hdr("o1") });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("GET /orgs/:orgId/alerts is org-scoped (another org's alert-incidents are excluded)", async () => {
    await h.db.insert(incidents).values([
      { id: "o1:run-failed:x", orgId: "o1", source: "alert", severity: "high", title: "A", body: "" },
      { id: "o2:run-failed:y", orgId: "o2", source: "alert", severity: "high", title: "B", body: "" },
    ]);
    const app = makeApp(vi.fn(async () => {}));
    const list = await app.inject({ method: "GET", url: "/orgs/o1/alerts", headers: hdr("o1") });
    expect(list.json().alerts.map((a: { id: string }) => a.id)).toEqual(["o1:run-failed:x"]);
    await app.close();
  });
});

describe("runTickForAllOrgs", () => {
  it("ticks each org and returns a per-org report", async () => {
    await h.db.insert(tasks).values({ id: "k1", orgId: "o1", threadId: "t1", title: "do k1", state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    const start = vi.fn(async () => {});
    const out = await runTickForAllOrgs(
      { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090", start },
      { orgIds: ["o1", "o2"] },
    );
    expect(out.o1.dispatched.length).toBe(1);
    expect(out.o2.dispatched.length).toBe(0);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
