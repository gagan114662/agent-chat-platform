import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, auditLog } from "../db/schema.js";
import { append, verifyChain, listAudit } from "./audit-log.js";
import { authorize } from "./policy.js";
import { filterTools, isToolAllowed, authorizeTool } from "../mcp/acl.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("audit log (#150.3) — hash chain", () => {
  it("links entries and verifies intact", async () => {
    await append(h.db, { orgId: "o1", actorKind: "agent", actorId: "a1", action: "run.merged", resource: "r1" });
    await append(h.db, { orgId: "o1", actorKind: "human", actorId: "m1", action: "payment.approved", resource: "b1", payload: { amountCents: 4900 } });
    const v = await verifyChain(h.db, "o1");
    expect(v).toMatchObject({ ok: true, entries: 2 });
    const entries = await listAudit(h.db, "o1");
    expect(entries[0].action).toBe("payment.approved"); // newest first
    expect(entries[1].prevHash).toBe(""); // genesis
    expect(entries[0].prevHash).toBe(entries[1].hash); // chained
  });

  it("detects tampering (an edited payload breaks the chain)", async () => {
    await append(h.db, { orgId: "o1", actorKind: "human", actorId: "m1", action: "payment.approved", resource: "b1", payload: { amountCents: 100 } });
    await append(h.db, { orgId: "o1", actorKind: "human", actorId: "m1", action: "outreach.sent", resource: "b1" });
    expect((await verifyChain(h.db, "o1")).ok).toBe(true);
    // tamper: change the recorded amount in place (hash now mismatches)
    await h.db.update(auditLog).set({ payload: { amountCents: 999999 } }).where(eq(auditLog.seq, 0));
    const v = await verifyChain(h.db, "o1");
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
  });
});

describe("per-action authz (#150.3)", () => {
  it("blocks an agent from money/destructive actions; admin-approved passes", () => {
    expect(authorize({ role: "agent", action: "payment.charge", amountCents: 5000 })).toMatchObject({ allow: false, requiresHuman: true });
    expect(authorize({ role: "agent", action: "delete prod database" })).toMatchObject({ allow: false });
    expect(authorize({ role: "admin", action: "payment.charge" })).toMatchObject({ allow: true });
    expect(authorize({ role: "agent", action: "tool.call", resource: "fs.read" })).toMatchObject({ allow: true });
    expect(authorize({ role: "viewer", action: "message.post" })).toMatchObject({ allow: false });
  });
});

describe("MCP tool ACLs (#150.1)", () => {
  it("hides tools outside the agent's role", () => {
    expect(isToolAllowed("coder", "fs.write")).toBe(true);
    expect(isToolAllowed("coder", "payment.charge")).toBe(false);
    expect(isToolAllowed("researcher", "web.search")).toBe(true);
    expect(isToolAllowed("researcher", "git.commit")).toBe(false);
    const tools = [{ name: "fs.read" }, { name: "git.commit" }, { name: "payment.charge" }, { name: "web.search" }];
    expect(filterTools(tools, "coder").map((t) => t.name)).toEqual(["fs.read", "git.commit"]);
    expect(authorizeTool("coder", "payment.charge")).toMatchObject({ allow: false });
  });
});
