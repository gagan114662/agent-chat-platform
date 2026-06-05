import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import {
  createAutomation, listAutomations, setEnabled, deleteAutomation,
  runDueScheduleAutomations, fireEventAutomations, executeAction, type AutomationDeps,
} from "./automations.js";
import { type StartRun } from "./tick.js";
import type { SlackClient } from "../integrations/slack.js";
import { orgs, workspaces, channels, threads, repos, agents, runs, tasks, automations } from "../db/schema.js";
import { listMessages } from "../chat/messages.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// FAKE temporal: never touched (the injected `start` stands in for startFusionRun).
const temporalStub = { workflow: { start: async () => { throw new Error("temporal client must not be called"); } } } as any;

beforeEach(async () => {
  process.env.E2E_GITHUB_TOKEN = "tok"; // repo.tokenEnvVar resolves → run action ready
  await h.reset();
  await h.db.insert(orgs).values([{ id: "o1", name: "O" }, { id: "o2", name: "O B" }]);
  await h.db.insert(workspaces).values([
    { id: "w1", orgId: "o1", name: "W" },
    { id: "w2", orgId: "o2", name: "W B" },
  ]);
  await h.db.insert(repos).values([
    { id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "acme", githubName: "app", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge" },
  ]);
  await h.db.insert(channels).values([{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }]);
  await h.db.insert(threads).values([
    { id: "t1", orgId: "o1", channelId: "c1", title: "T1", repoId: "r1" },
    { id: "tnorepo", orgId: "o1", channelId: "c1", title: "Tnorepo" }, // no repo → run action guarded
  ]);
  await h.db.insert(agents).values([
    { id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} },
  ]);
});

function makeDeps(start: StartRun): AutomationDeps {
  return { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090", start };
}

// Fake Slack client that records every post — no live Slack.
function fakeSlack(calls: { channel: string; text: string }[]): SlackClient {
  return { postMessage: async (channel, text) => { calls.push({ channel, text }); } };
}

describe("automations — CRUD (org-scoped)", () => {
  it("create/list/setEnabled/delete are org-scoped", async () => {
    const a = await createAutomation(h.db, {
      orgId: "o1", name: "brief", createdById: "m1",
      trigger: { type: "schedule", everyMinutes: 60 },
      action: { type: "message", threadId: "t1", body: "morning brief" },
    });
    expect(a.enabled).toBe(true);
    // listed for o1, not for o2
    expect((await listAutomations(h.db, "o1")).map((x) => x.id)).toContain(a.id);
    expect(await listAutomations(h.db, "o2")).toEqual([]);
    // setEnabled is org-scoped: o2 cannot touch o1's automation
    expect(await setEnabled(h.db, "o2", a.id, false)).toBe(false);
    expect(await setEnabled(h.db, "o1", a.id, false)).toBe(true);
    const [after] = await h.db.select().from(automations).where(eq(automations.id, a.id));
    expect(after.enabled).toBe(false);
    // delete is org-scoped
    expect(await deleteAutomation(h.db, "o2", a.id)).toBe(false);
    expect(await deleteAutomation(h.db, "o1", a.id)).toBe(true);
    expect(await listAutomations(h.db, "o1")).toEqual([]);
  });
});

describe("runDueScheduleAutomations", () => {
  it("fires a due schedule (message action), sets lastFiredAt; re-run immediately → 0 (not due)", async () => {
    await createAutomation(h.db, {
      orgId: "o1", name: "brief", createdById: "m1",
      trigger: { type: "schedule", everyMinutes: 60 },
      action: { type: "message", threadId: "t1", body: "morning brief" },
    });
    const start = vi.fn(async () => {});
    const now = new Date();
    const fired = await runDueScheduleAutomations(h.db, makeDeps(start), { orgId: "o1", now });
    expect(fired).toBe(1);
    // a message was posted into the thread
    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.some((m) => m.body === "morning brief")).toBe(true);
    // lastFiredAt set
    const [a] = await h.db.select().from(automations).where(eq(automations.orgId, "o1"));
    expect(a.lastFiredAt).toBeTruthy();
    // immediate re-run → not due (lastFiredAt newer than everyMinutes ago)
    const again = await runDueScheduleAutomations(h.db, makeDeps(start), { orgId: "o1", now: new Date(now.getTime() + 1000) });
    expect(again).toBe(0);
  });

  it("disabled schedule automation never fires", async () => {
    const a = await createAutomation(h.db, {
      orgId: "o1", name: "off", createdById: "m1",
      trigger: { type: "schedule", everyMinutes: 60 },
      action: { type: "message", threadId: "t1", body: "nope" },
    });
    await setEnabled(h.db, "o1", a.id, false);
    const fired = await runDueScheduleAutomations(h.db, makeDeps(vi.fn(async () => {})), { orgId: "o1", now: new Date() });
    expect(fired).toBe(0);
    expect(await listMessages(h.db, "t1", "o1")).toEqual([]);
  });

  it("is org-scoped — does not fire another org's automation", async () => {
    await createAutomation(h.db, {
      orgId: "o1", name: "brief", createdById: "m1",
      trigger: { type: "schedule", everyMinutes: 60 },
      action: { type: "message", threadId: "t1", body: "o1 brief" },
    });
    const fired = await runDueScheduleAutomations(h.db, makeDeps(vi.fn(async () => {})), { orgId: "o2", now: new Date() });
    expect(fired).toBe(0);
  });
});

describe("fireEventAutomations", () => {
  it("fires a matching event automation (run action) — the starter is called", async () => {
    await createAutomation(h.db, {
      orgId: "o1", name: "fix-on-fail", createdById: "m1",
      trigger: { type: "event", event: "outcome:checks_failed" },
      action: { type: "run", threadId: "t1", agentId: "a1", intent: "fix the failing checks" },
    });
    const start = vi.fn(async () => {});
    const fired = await fireEventAutomations(h.db, makeDeps(start), { orgId: "o1", event: "outcome:checks_failed" });
    expect(fired).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
    // a pending run was created
    const pending = await h.db.select().from(runs).where(eq(runs.state, "pending"));
    expect(pending.length).toBe(1);
  });

  it("does not fire on a non-matching event", async () => {
    await createAutomation(h.db, {
      orgId: "o1", name: "fix-on-fail", createdById: "m1",
      trigger: { type: "event", event: "outcome:checks_failed" },
      action: { type: "run", threadId: "t1", agentId: "a1", intent: "x" },
    });
    const start = vi.fn(async () => {});
    const fired = await fireEventAutomations(h.db, makeDeps(start), { orgId: "o1", event: "outcome:merged" });
    expect(fired).toBe(0);
    expect(start).not.toHaveBeenCalled();
  });

  it("guards a run action when the thread has no repo/token → starter skipped, no run", async () => {
    await createAutomation(h.db, {
      orgId: "o1", name: "no-repo", createdById: "m1",
      trigger: { type: "event", event: "outcome:checks_failed" },
      action: { type: "run", threadId: "tnorepo", agentId: "a1", intent: "x" },
    });
    const start = vi.fn(async () => {});
    const fired = await fireEventAutomations(h.db, makeDeps(start), { orgId: "o1", event: "outcome:checks_failed" });
    expect(fired).toBe(0); // guarded — no repo to resolve
    expect(start).not.toHaveBeenCalled();
    expect(await h.db.select().from(runs)).toEqual([]);
  });

  it("a slack action posts via the injected Slack client (configured channel/text)", async () => {
    const calls: { channel: string; text: string }[] = [];
    const deps: AutomationDeps = { ...makeDeps(vi.fn(async () => {})), makeSlack: () => fakeSlack(calls) };
    const ran = await executeAction(h.db, deps, "o1", { type: "slack", channel: "#general", text: "deploy done" });
    expect(ran).toBe(true);
    expect(calls).toEqual([{ channel: "#general", text: "deploy done" }]);
  });

  it("a slack action is guarded — unconfigured Slack → skipped, no throw", async () => {
    // No makeSlack injected and no Slack env → makeSlackClient throws "slack not
    // configured"; executeAction must catch and skip (return false) rather than break.
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_WEBHOOK_URL;
    const deps = makeDeps(vi.fn(async () => {}));
    const ran = await executeAction(h.db, deps, "o1", { type: "slack", channel: "#general", text: "x" });
    expect(ran).toBe(false);
  });

  it("a slack action that throws at post time is guarded — skipped, no throw", async () => {
    const deps: AutomationDeps = {
      ...makeDeps(vi.fn(async () => {})),
      makeSlack: () => ({ postMessage: async () => { throw new Error("slack 500"); } }),
    };
    const ran = await executeAction(h.db, deps, "o1", { type: "slack", channel: "#general", text: "x" });
    expect(ran).toBe(false);
  });

  it("disabled event automation never fires", async () => {
    const a = await createAutomation(h.db, {
      orgId: "o1", name: "off", createdById: "m1",
      trigger: { type: "event", event: "outcome:checks_failed" },
      action: { type: "message", threadId: "t1", body: "nope" },
    });
    await setEnabled(h.db, "o1", a.id, false);
    const fired = await fireEventAutomations(h.db, makeDeps(vi.fn(async () => {})), { orgId: "o1", event: "outcome:checks_failed" });
    expect(fired).toBe(0);
  });
});
