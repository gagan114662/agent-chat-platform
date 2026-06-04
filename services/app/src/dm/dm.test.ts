import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { listPrincipals, getOrCreateDm, listDms } from "./dm.js";
import { orgs, workspaces, members, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" });
  await h.db.insert(members).values({ id: "m2", orgId: "o1", workspaceId: "w1", displayName: "Dana" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
});

describe("dm", () => {
  it("lists principals (members + agents), excluding the actor", async () => {
    const ps = await listPrincipals(h.db, "o1", "m1");
    expect(ps.find((p) => p.id === "m1")).toBeUndefined();
    expect(ps.find((p) => p.id === "m2")).toMatchObject({ kind: "human", name: "Dana" });
    expect(ps.find((p) => p.id === "a1")).toMatchObject({ kind: "agent", name: "Coder" });
  });

  it("get-or-creates a DM with an agent (idempotent), titled by peer name", async () => {
    const t1 = await getOrCreateDm(h.db, { orgId: "o1", peerKind: "agent", peerId: "a1" });
    expect(t1.kind).toBe("dm");
    expect(t1.title).toBe("Coder");
    expect(t1.channelId).toBeNull();
    const t2 = await getOrCreateDm(h.db, { orgId: "o1", peerKind: "agent", peerId: "a1" });
    expect(t2.id).toBe(t1.id); // idempotent
    expect((await listDms(h.db, "o1")).length).toBe(1);
  });

  it("throws on an unknown principal", async () => {
    await expect(getOrCreateDm(h.db, { orgId: "o1", peerKind: "human", peerId: "ghost" })).rejects.toThrow(/principal not found/);
  });
});
