import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { markRead, unreadCounts, mentionsInbox } from "./read-state.js";
import { orgs, workspaces, channels, threads, messages, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const T1 = new Date("2024-01-01T00:00:00Z");
const T2 = new Date("2024-01-02T00:00:00Z");
const T3 = new Date("2024-01-03T00:00:00Z");

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "you", role: "admin" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T1", createdAt: T1 });
  // 3 messages at T1, T2, T3
  await h.db.insert(messages).values([
    { id: "msg1", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "hello one", createdAt: T1 },
    { id: "msg2", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "hello two @you please look", createdAt: T2 },
    { id: "msg3", orgId: "o1", threadId: "t1", authorKind: "human", authorId: "u", kind: "chat", body: "hello three", createdAt: T3 },
  ]);
});

describe("read-state unread counts", () => {
  it("no read-state row → all messages unread", async () => {
    const counts = await unreadCounts(h.db, "o1", "m1");
    expect(counts.find((c) => c.threadId === "t1")?.unread).toBe(3);
  });

  it("markRead at msg2's time → unread 1 (only msg3 after)", async () => {
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T2 });
    const counts = await unreadCounts(h.db, "o1", "m1");
    expect(counts.find((c) => c.threadId === "t1")?.unread).toBe(1);
  });

  it("markRead at the latest time → thread drops out (0 unread)", async () => {
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T3 });
    const counts = await unreadCounts(h.db, "o1", "m1");
    expect(counts.find((c) => c.threadId === "t1")).toBeUndefined();
  });

  it("markRead upserts (second call updates lastReadAt)", async () => {
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T1 });
    expect((await unreadCounts(h.db, "o1", "m1")).find((c) => c.threadId === "t1")?.unread).toBe(2);
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T3 });
    expect((await unreadCounts(h.db, "o1", "m1")).find((c) => c.threadId === "t1")).toBeUndefined();
  });

  it("org-scoped: another org's threads are excluded", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(channels).values({ id: "c2", orgId: "o2", workspaceId: "w2", name: "g2" });
    await h.db.insert(threads).values({ id: "t2", orgId: "o2", channelId: "c2", title: "T2", createdAt: T1 });
    await h.db.insert(messages).values({ id: "m2x", orgId: "o2", threadId: "t2", authorKind: "human", authorId: "u", kind: "chat", body: "secret", createdAt: T1 });
    const counts = await unreadCounts(h.db, "o1", "m1");
    expect(counts.map((c) => c.threadId)).not.toContain("t2");
  });

  it("read-state is per-user: a different user still sees all unread", async () => {
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T3 });
    await h.db.insert(members).values({ id: "m2", orgId: "o1", workspaceId: "w1", displayName: "other", role: "member" });
    const counts = await unreadCounts(h.db, "o1", "m2");
    expect(counts.find((c) => c.threadId === "t1")?.unread).toBe(3);
  });
});

describe("read-state mentions inbox", () => {
  it("returns a thread with an unread @handle mention", async () => {
    const inbox = await mentionsInbox(h.db, "o1", "m1", "you");
    expect(inbox.map((i) => i.threadId)).toContain("t1");
  });

  it("excludes a mention already read (after markRead past it)", async () => {
    await markRead(h.db, { orgId: "o1", userId: "m1", threadId: "t1", at: T2 });
    const inbox = await mentionsInbox(h.db, "o1", "m1", "you");
    expect(inbox.map((i) => i.threadId)).not.toContain("t1");
  });

  it("org-scoped: a mention in another org is not returned", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(channels).values({ id: "c2", orgId: "o2", workspaceId: "w2", name: "g2" });
    await h.db.insert(threads).values({ id: "t2", orgId: "o2", channelId: "c2", title: "T2", createdAt: T1 });
    await h.db.insert(messages).values({ id: "m2x", orgId: "o2", threadId: "t2", authorKind: "human", authorId: "u", kind: "chat", body: "hi @you", createdAt: T1 });
    const inbox = await mentionsInbox(h.db, "o1", "m1", "you");
    expect(inbox.map((i) => i.threadId)).not.toContain("t2");
  });

  it("does not match a different handle", async () => {
    const inbox = await mentionsInbox(h.db, "o1", "m1", "someoneelse");
    expect(inbox).toEqual([]);
  });
});
