import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createMessage, listMessages, messageAttachments } from "./messages.js";
import { createFile } from "../files/files.js";
import { verifyFileSig } from "../files/files.js";
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

describe("message attachments (#76)", () => {
  beforeEach(async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "Org B" });
  });

  it("createMessage stores in-org fileIds in metadata.attachments", async () => {
    const f = await createFile(h.db, { orgId: "o1", name: "spec.md", byKind: "human", byId: "m1" });
    const msg = await createMessage(h.db, {
      orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "see file", fileIds: [f.id],
    });
    expect((msg.metadata as { attachments?: string[] }).attachments).toEqual([f.id]);
  });

  it("createMessage drops a cross-org fileId (no leak)", async () => {
    const own = await createFile(h.db, { orgId: "o1", name: "a.md", byKind: "human", byId: "m1" });
    const foreign = await createFile(h.db, { orgId: "o2", name: "secret.md", byKind: "human", byId: "m2" });
    const msg = await createMessage(h.db, {
      orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "x", fileIds: [own.id, foreign.id],
    });
    expect((msg.metadata as { attachments?: string[] }).attachments).toEqual([own.id]);
  });

  it("no fileIds → metadata.attachments is absent (unchanged behavior)", async () => {
    const msg = await createMessage(h.db, {
      orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "plain",
    });
    expect((msg.metadata as { attachments?: string[] }).attachments).toBeUndefined();
  });

  it("messageAttachments resolves name/contentType/size + a signed download URL", async () => {
    const f = await createFile(h.db, { orgId: "o1", name: "report.pdf", contentType: "application/pdf", size: 123, byKind: "human", byId: "m1" });
    const msg = await createMessage(h.db, {
      orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "see", fileIds: [f.id],
    });
    const resolved = await messageAttachments(h.db, "o1", msg);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ id: f.id, name: "report.pdf", contentType: "application/pdf", size: 123 });
    expect(typeof resolved[0].downloadUrl).toBe("string");
    // the URL carries a valid "get" signature for this file
    expect(resolved[0].downloadUrl).toContain(`/files/${f.id}/download?sig=`);
    const token = resolved[0].downloadUrl.split("sig=")[1];
    expect(verifyFileSig(f.id, "get", token)).toBe(true);
  });

  it("messageAttachments is org-scoped: a foreign org sees nothing", async () => {
    const f = await createFile(h.db, { orgId: "o1", name: "a.md", byKind: "human", byId: "m1" });
    const msg = await createMessage(h.db, {
      orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", body: "x", fileIds: [f.id],
    });
    expect(await messageAttachments(h.db, "o2", msg)).toEqual([]);
  });
});
