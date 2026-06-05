import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createMessage, listMessages } from "./messages.js";
import { orgs, workspaces, channels, threads } from "../db/schema.js";

const h = testDb();

beforeAll(async () => { await h.reset(); });
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "Org" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "WS" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T" });
});

describe("messages", () => {
  it("creates and lists messages in order", async () => {
    await createMessage(h.db, { orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "hi" });
    // Distinct timestamps so the chronological assertion below can't flake on a
    // same-millisecond tie (listMessages orders by (createdAt, id); id is a random UUID).
    await new Promise((r) => setTimeout(r, 2));
    await createMessage(h.db, { orgId: "o1", threadId: "t1", authorKind: "agent", authorId: "a1", body: "hello", kind: "system" });
    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.map((m) => m.body)).toEqual(["hi", "hello"]);
    expect(msgs[1].authorKind).toBe("agent");
    expect(msgs[1].kind).toBe("system");
  });

  it("does not leak another org's messages via the thread id (cross-tenant IDOR)", async () => {
    await createMessage(h.db, { orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "secret" });
    // org B requests org A's thread id → must be empty
    expect(await listMessages(h.db, "t1", "o2")).toEqual([]);
  });
});
