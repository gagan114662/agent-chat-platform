import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { summarizeThread, defaultSummarizer } from "./summarize.js";
import { createMessage, listMessages } from "./messages.js";
import { registerRoutes } from "../http/routes.js";
import { orgs, workspaces, channels, threads } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// temporal is never reached by /summarize (it posts a system message, no mention loop).
const temporalStub = { workflow: { start: async () => { throw new Error("temporal must not be called"); } } } as any;
function makeApp() {
  const app = Fastify();
  registerRoutes(app, { db: h.db, sql: h.sql, temporal: temporalStub, sandboxUrl: "http://runner:8090" });
  return app;
}

async function seedThread() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T" });
}

async function seedMessages() {
  // A small conversation: a human, an agent, and a pr_card outcome.
  await createMessage(h.db, { id: "s1", orgId: "oA", threadId: "tA", authorKind: "human", authorId: "alice", body: "Can we ship the login fix?" });
  await createMessage(h.db, { id: "s2", orgId: "oA", threadId: "tA", authorKind: "agent", authorId: "coder", body: "On it." });
  await createMessage(h.db, {
    id: "s3", orgId: "oA", threadId: "tA", authorKind: "agent", authorId: "coder",
    kind: "pr_card", body: "Opened PR #42: fix login with special characters",
  });
  await createMessage(h.db, { id: "s4", orgId: "oA", threadId: "tA", authorKind: "human", authorId: "alice", body: "Looks good, merging." });
}

describe("summarizeThread (#77)", () => {
  beforeEach(async () => { await seedThread(); });

  it("returns a deterministic recap mentioning the count, participants and the PR", async () => {
    await seedMessages();
    const { summary } = await summarizeThread(h.db, { orgId: "oA", threadId: "tA" });
    expect(summary).toContain("4 messages");
    expect(summary).toContain("2 participants");
    expect(summary).toContain("1 human");
    expect(summary).toContain("1 agent");
    expect(summary).toContain("PR #42");
    expect(summary).toContain("Latest: Looks good, merging.");
  });

  it("empty thread → a sensible 'no messages' summary", async () => {
    const { summary } = await summarizeThread(h.db, { orgId: "oA", threadId: "tA" });
    expect(summary).toMatch(/no messages/i);
  });

  it("is org-scoped: a foreign org sees no messages", async () => {
    await seedMessages();
    const { summary } = await summarizeThread(h.db, { orgId: "oB", threadId: "tA" });
    expect(summary).toMatch(/no messages/i);
  });

  it("honors an injected summarizer (LLM-pluggable seam)", async () => {
    await seedMessages();
    const { summary } = await summarizeThread(h.db, {
      orgId: "oA", threadId: "tA",
      summarize: (msgs) => `LLM recap of ${msgs.length} messages`,
    });
    expect(summary).toBe("LLM recap of 4 messages");
  });
});

describe("defaultSummarizer (pure)", () => {
  it("handles the empty case", () => {
    expect(defaultSummarizer([])).toMatch(/no messages/i);
  });
});

describe("POST /threads/:id/summarize (#77 route)", () => {
  beforeEach(async () => { await seedThread(); });

  it("posts a system summary message and returns the recap", async () => {
    await seedMessages();
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/threads/tA/summarize", headers: { "x-org-id": "oA" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toContain("4 messages");
    expect(res.json().summary).toContain("PR #42");

    // A system summary message was posted into the thread by the summarizer.
    const msgs = await listMessages(h.db, "tA", "oA");
    const summaryMsg = msgs.find((m) => m.kind === "system" && m.authorId === "summarizer");
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.body).toBe(res.json().summary);
    await app.close();
  });

  it("cross-org thread → 404 (no message written)", async () => {
    await seedMessages();
    const app = makeApp();
    const res = await app.inject({ method: "POST", url: "/threads/tA/summarize", headers: { "x-org-id": "oB" } });
    expect(res.statusCode).toBe(404);
    // org A still has only the 4 seeded messages — no summary posted.
    const msgs = await listMessages(h.db, "tA", "oA");
    expect(msgs.filter((m) => m.authorId === "summarizer")).toHaveLength(0);
    await app.close();
  });
});
