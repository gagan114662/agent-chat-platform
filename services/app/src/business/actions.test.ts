import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, channels, threads, goals, tasks, paymentIntents } from "../db/schema.js";
import { createBusiness, businessPnl, funnel, decidePaymentIntent, listPaymentIntents } from "./businesses.js";
import { createGoal, decomposeGoal } from "../autonomy/goals.js";
import { parseBusinessAction, runBusinessGoal } from "./actions.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

describe("parseBusinessAction (#146)", () => {
  it("parses charges, campaigns, and signups; ignores code tasks", () => {
    expect(parseBusinessAction("charge $39 to dave@test.com")).toEqual({ kind: "charge", amountCents: 3900, customer: "dave@test.com" });
    expect(parseBusinessAction("email campaign to a@x.com, b@x.com")).toEqual({ kind: "campaign", channel: "email", audience: "a@x.com, b@x.com" });
    expect(parseBusinessAction("record signup alice@x.com")).toEqual({ kind: "signup", identifier: "alice@x.com" });
    expect(parseBusinessAction("refactor the auth module")).toBeNull();
  });
});

describe("runBusinessGoal (#146): agents → funnel", () => {
  let bid: string, gid: string;
  beforeEach(async () => {
    await h.reset();
    await h.db.insert(orgs).values({ id: "o1", name: "O" });
    await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
    await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "g" });
    await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
    bid = (await createBusiness(h.db, { orgId: "o1", name: "ResumeAI" })).id;
    const g = await createGoal(h.db, { orgId: "o1", title: "Land first paying customer", criteria: "email campaign to lead1@x.com, lead2@x.com\ncharge $39 to dave@test.com", byKind: "human", byId: "m1", businessId: bid });
    gid = g.id;
    await decomposeGoal(h.db, { orgId: "o1", goalId: g.id, threadId: "t1" });
  });

  it("drafts pending charges/campaigns into the approval surface + lands tasks at 'merged'", async () => {
    const res = await runBusinessGoal(h.db, "o1", gid);
    expect(res.drafted).toHaveLength(2);
    // the funnel now has a PENDING charge an agent/goal created (not a human typing it)
    const intents = await listPaymentIntents(h.db, "o1", bid);
    expect(intents).toHaveLength(1);
    expect(intents[0].state).toBe("pending");
    expect(intents[0].taskId).toBeTruthy(); // traced to the goal task
    // those tasks are "merged" (drafted, awaiting human approval), not faked done
    const ts = await h.db.select().from(tasks).where(eq(tasks.goalId, gid));
    expect(ts.every((t) => t.state === "merged")).toBe(true);
    // nothing booked yet — money is still gated
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(0);
  });

  it("human approval books revenue AND verifies the drafting task (done)", async () => {
    await runBusinessGoal(h.db, "o1", gid);
    const intent = (await listPaymentIntents(h.db, "o1", bid))[0];
    await decidePaymentIntent(h.db, { orgId: "o1", intentId: intent.id, approve: true, byUserId: "m1" });
    expect((await businessPnl(h.db, "o1", bid)).revenueCents).toBe(3900);
    // the goal task that drafted the charge is now verified (done), not stuck at merged
    const [tk] = await h.db.select().from(tasks).where(and(eq(tasks.orgId, "o1"), eq(tasks.id, intent.taskId!)));
    expect(tk.state).toBe("done");
  });
});
