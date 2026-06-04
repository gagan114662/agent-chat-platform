import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { importLinearIssues, type LinearClient, type LinearIssue } from "./linear.js";
import { orgs, workspaces, channels, threads, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const ISSUES: LinearIssue[] = [
  { id: "i1", identifier: "ENG-1", title: "First", description: "d1", state: "Todo", url: "https://linear.app/i1" },
  { id: "i2", identifier: "ENG-2", title: "Second", state: "In Progress", url: "https://linear.app/i2" },
];

function fakeClient(issues: LinearIssue[]): LinearClient {
  return { listIssues: async () => issues };
}

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T" });
}

describe("importLinearIssues", () => {
  beforeEach(seed);

  it("creates one org-scoped Task per issue with [IDENT] title", async () => {
    const ids = await importLinearIssues(h.db, { orgId: "oA", threadId: "tA", client: fakeClient(ISSUES) });
    expect(ids).toEqual(["linear:i1", "linear:i2"]);

    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["linear:i1"]).toMatchObject({
      orgId: "oA", threadId: "tA", title: "[ENG-1] First",
      state: "open", createdByKind: "integration", createdById: "linear",
    });
    expect(byId["linear:i2"].title).toBe("[ENG-2] Second");
  });

  it("is idempotent: re-import creates 0 new Tasks (deterministic id)", async () => {
    const first = await importLinearIssues(h.db, { orgId: "oA", threadId: "tA", client: fakeClient(ISSUES) });
    expect(first).toHaveLength(2);
    const second = await importLinearIssues(h.db, { orgId: "oA", threadId: "tA", client: fakeClient(ISSUES) });
    expect(second).toEqual([]);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);
  });
});
