import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { ensureDefaultAssistant, defaultAssistantId } from "./default-assistant.js";
import { resolveMention } from "./agents.js";
import { orgs, workspaces, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "Org" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "WS" });
});

describe("default workspace assistant (#87)", () => {
  it("creates the iris agent once with a deterministic id and claude-code adapter", async () => {
    const a = await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    expect(a.id).toBe(defaultAssistantId("o1", "w1"));
    expect(a.handle).toBe("iris");
    expect(a.displayName).toBe("Iris");
    expect(a.adapter).toBe("claude-code");
    expect(a.orgId).toBe("o1");
    expect(a.workspaceId).toBe("w1");
  });

  it("is idempotent — a second call creates no duplicate", async () => {
    const first = await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    const second = await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    expect(second.id).toBe(first.id);
    const rows = await h.db.select().from(agents).where(eq(agents.orgId, "o1"));
    expect(rows.length).toBe(1);
  });

  it("is resolvable via resolveMention(db, orgId, 'iris')", async () => {
    await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    const resolved = await resolveMention(h.db, "o1", "iris");
    expect(resolved?.id).toBe(defaultAssistantId("o1", "w1"));
  });

  it("two workspaces in one org both provision without violating the org-handle unique index", async () => {
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o1", name: "WS2" });
    const a1 = await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    const a2 = await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w2" });
    expect(a1.id).not.toBe(a2.id);
    // first workspace keeps "iris"; the second gets a deterministic suffixed handle
    expect(a1.handle).toBe("iris");
    expect(a2.handle).toBe("iris-w2");
    const rows = await h.db.select().from(agents).where(eq(agents.orgId, "o1"));
    expect(rows.length).toBe(2);
  });

  it("is org-scoped — each org gets its own iris", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "Org2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "WS2" });
    await ensureDefaultAssistant(h.db, { orgId: "o1", workspaceId: "w1" });
    await ensureDefaultAssistant(h.db, { orgId: "o2", workspaceId: "w2" });
    // each org resolves its own iris; o2 never sees o1's
    expect((await resolveMention(h.db, "o1", "iris"))?.id).toBe(defaultAssistantId("o1", "w1"));
    expect((await resolveMention(h.db, "o2", "iris"))?.id).toBe(defaultAssistantId("o2", "w2"));
  });
});
