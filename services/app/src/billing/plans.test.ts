import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { currentPlan, usage, checkQuota, setSubscription, STARTER_PLAN_ID } from "./plans.js";
import { orgs, workspaces, members, agents, threads, messages, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O2" }]);
  await h.db.insert(workspaces).values([{ id: "w1", orgId: "o1", name: "W" }, { id: "w2", orgId: "o2", name: "W2" }]);
});

describe("plans + subscriptions + usage/quota (#85)", () => {
  it("defaults to the Starter plan when the org has no subscription row", async () => {
    const p = await currentPlan(h.db, "o1");
    expect(p.id).toBe(STARTER_PLAN_ID);
    expect(p.name).toBe("Starter");
    expect(p.agentLimit).toBe(1);
    expect(p.seatLimit).toBe(1);
  });

  it("usage counts seats/agents/messages/tasks org-scoped", async () => {
    await h.db.insert(members).values([
      { id: "m1", orgId: "o1", workspaceId: "w1", displayName: "A" },
      { id: "m2", orgId: "o1", workspaceId: "w1", displayName: "B" },
      { id: "mx", orgId: "o2", workspaceId: "w2", displayName: "X" }, // other org
    ]);
    await h.db.insert(agents).values([
      { id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" },
      { id: "ax", orgId: "o2", workspaceId: "w2", handle: "cx", displayName: "CX" },
    ]);
    await h.db.insert(threads).values({ id: "t1", orgId: "o1", title: "T" });
    await h.db.insert(messages).values([
      { id: "msg1", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "hi" },
      { id: "msg2", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "yo" },
    ]);
    await h.db.insert(tasks).values({ id: "tk1", orgId: "o1", threadId: "t1", title: "Task", createdByKind: "human", createdById: "m1" });

    const u = await usage(h.db, "o1");
    expect(u).toEqual({ seats: 2, agents: 1, messages: 2, tasks: 1 });
  });

  it("checkQuota('agents') ok under limit, not-ok at limit (Starter agentLimit=1)", async () => {
    let q = await checkQuota(h.db, "o1", "agents");
    expect(q).toEqual({ used: 0, limit: 1, ok: true });

    await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" });
    q = await checkQuota(h.db, "o1", "agents");
    expect(q).toEqual({ used: 1, limit: 1, ok: false });
  });

  it("checkQuota('seats') reflects member count vs the plan seat limit", async () => {
    await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "A" });
    const q = await checkQuota(h.db, "o1", "seats");
    expect(q).toEqual({ used: 1, limit: 1, ok: false }); // Starter seatLimit=1, already 1 member
  });

  it("setSubscription to Pro raises the limits", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro" });
    const p = await currentPlan(h.db, "o1");
    expect(p.id).toBe("pro");
    expect(p.agentLimit).toBe(25);

    await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" });
    const q = await checkQuota(h.db, "o1", "agents");
    expect(q.ok).toBe(true);
    expect(q.limit).toBe(25);
  });

  it("setSubscription upserts (changing plan updates the existing row)", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro" });
    await setSubscription(h.db, { orgId: "o1", planId: "growth", stripeCustomerId: "cus_1" });
    const p = await currentPlan(h.db, "o1");
    expect(p.id).toBe("growth");
  });

  it("unlimited (-1) plan is always ok regardless of usage", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "custom" });
    await h.db.insert(agents).values([
      { id: "a1", orgId: "o1", workspaceId: "w1", handle: "c1", displayName: "C1" },
      { id: "a2", orgId: "o1", workspaceId: "w1", handle: "c2", displayName: "C2" },
    ]);
    const q = await checkQuota(h.db, "o1", "agents");
    expect(q.limit).toBe(-1);
    expect(q.ok).toBe(true);
  });

  it("is org-scoped (a subscription for o1 does not affect o2)", async () => {
    await setSubscription(h.db, { orgId: "o1", planId: "pro" });
    const p2 = await currentPlan(h.db, "o2");
    expect(p2.id).toBe(STARTER_PLAN_ID);
  });
});
