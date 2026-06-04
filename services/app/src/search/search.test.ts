import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { searchMessages } from "./search.js";
import { orgs, workspaces, channels, threads, messages } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "Login bug", createdAt: new Date("2024-01-01T00:00:00Z") });
  await h.db.insert(messages).values({ id: "m1", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u1", kind: "chat", body: "please fix the login flow", metadata: {} });
  await h.db.insert(messages).values({ id: "m2", orgId: "o1", threadId: "t1", authorKind: "agent", authorId: "a1", kind: "system", body: "checks: pending", metadata: {} });
});

describe("searchMessages", () => {
  it("matches body case-insensitively and joins thread title", async () => {
    const res = await searchMessages(h.db, "o1", "LOGIN");
    expect(res.map((r) => r.messageId)).toEqual(["m1"]);
    expect(res[0].threadTitle).toBe("Login bug");
    expect(res[0].threadId).toBe("t1");
  });
  it("returns [] for empty query", async () => {
    expect(await searchMessages(h.db, "o1", "  ")).toEqual([]);
  });
  it("is org-scoped", async () => {
    expect(await searchMessages(h.db, "o2", "login")).toEqual([]);
  });
});
