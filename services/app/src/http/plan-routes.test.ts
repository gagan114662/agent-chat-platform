import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import type { Client } from "@temporalio/client";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerPlanRoutes } from "./plan-routes.js";
import { listMessages } from "../chat/messages.js";
import { transitionRun, openTaskForMention } from "../tasks/tasks.js";
import { orgs, workspaces, channels, threads, agents, repos, runs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_PLAN_TEST";

async function seedPlanRun() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: TOKEN_ENV, planMode: true,
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
  await h.db.insert(agents).values({ id: "aA", orgId: "oA", workspaceId: "wA", handle: "coder", displayName: "C", adapter: "fake", config: {} });
  const { run } = await openTaskForMention(h.db, { orgId: "oA", threadId: "tA", intent: "ship feature", agentId: "aA", createdByKind: "human", createdById: "mA" });
  // pending → awaiting_plan_approval (the plan-mode park).
  await transitionRun(h.db, run.id, "awaiting_plan_approval", {}, "oA");
  return run;
}

// Fake temporal client recording workflow starts (no network).
function makeFakeTemporal(starts: Array<{ workflowId: string; args: unknown[] }>): Client {
  return {
    workflow: {
      start: vi.fn(async (_wf: unknown, opts: { workflowId: string; args: unknown[] }) => {
        starts.push({ workflowId: opts.workflowId, args: opts.args });
        return {};
      }),
    },
  } as unknown as Client;
}

function makeApp(starts: Array<{ workflowId: string; args: unknown[] }>) {
  const app = Fastify();
  registerPlanRoutes(app, {
    db: h.db, sql: h.sql, temporal: makeFakeTemporal(starts), sandboxUrl: "http://sbx",
  });
  return app;
}

describe("plan routes", () => {
  beforeEach(async () => { process.env[TOKEN_ENV] = "tok"; await seedPlanRun(); });

  it("POST /runs/:id/approve-plan → run→running, posts approval, starts execute run", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const starts: Array<{ workflowId: string; args: unknown[] }> = [];
    const app = makeApp(starts);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve-plan`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("running");
    const msgs = await listMessages(h.db, "tA", "oA");
    expect(msgs.at(-1)?.body).toContain("plan approved");
    // startFusionRun kicked the execute workflow with planMode forced off.
    expect(starts).toHaveLength(1);
    expect((starts[0].args[0] as { planMode: boolean }).planMode).toBe(false);
    await app.close();
  });

  it("POST /runs/:id/reject-plan with notes → declines + re-plans", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const starts: Array<{ workflowId: string; args: unknown[] }> = [];
    const app = makeApp(starts);
    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/reject-plan`,
      headers: { "x-org-id": "oA" }, payload: { notes: "do X instead" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, replanned: true });
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("error"); // declined
    const msgs = await listMessages(h.db, "tA", "oA");
    const bodies = msgs.map((m) => m.body).join("\n");
    expect(bodies).toContain("plan rejected");
    expect(bodies).toContain("re-planning with steering: do X instead");
    // A fresh plan-mode run was started with the steering note appended.
    expect(starts).toHaveLength(1);
    const args = starts[0].args[0] as { planMode: boolean; intent: string };
    expect(args.planMode).toBe(true);
    expect(args.intent).toContain("do X instead");
    await app.close();
  });

  it("POST /runs/:id/reject-plan without notes → declines, no re-plan", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const starts: Array<{ workflowId: string; args: unknown[] }> = [];
    const app = makeApp(starts);
    const res = await app.inject({
      method: "POST", url: `/runs/${run.id}/reject-plan`, headers: { "x-org-id": "oA" }, payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, replanned: false });
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("error");
    expect(starts).toHaveLength(0);
    await app.close();
  });

  it("cross-org approve-plan is denied (404, no state change)", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    const starts: Array<{ workflowId: string; args: unknown[] }> = [];
    const app = makeApp(starts);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve-plan`, headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    const [after] = await h.db.select().from(runs).where(eq(runs.id, run.id));
    expect(after.state).toBe("awaiting_plan_approval");
    expect(starts).toHaveLength(0);
    await app.close();
  });

  it("approve-plan on a non-plan run is 404", async () => {
    const [run] = await h.db.select().from(runs).where(eq(runs.orgId, "oA"));
    await transitionRun(h.db, run.id, "running", {}, "oA"); // no longer awaiting_plan_approval
    const app = makeApp([]);
    const res = await app.inject({ method: "POST", url: `/runs/${run.id}/approve-plan`, headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
