import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerIntegrationRoutes } from "./integration-routes.js";
import type { LinearClient, LinearIssue } from "../integrations/linear.js";
import { orgs, workspaces, channels, threads, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const ISSUES: LinearIssue[] = [
  { id: "i1", identifier: "ENG-1", title: "First", state: "Todo", url: "https://linear.app/i1" },
  { id: "i2", identifier: "ENG-2", title: "Second", state: "Done", url: "https://linear.app/i2" },
];

function fakeLinear(issues: LinearIssue[]): LinearClient {
  return { listIssues: async () => issues };
}

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T" });
}

function makeApp() {
  const app = Fastify();
  registerIntegrationRoutes(app, { db: h.db, makeLinear: () => fakeLinear(ISSUES) });
  return app;
}

describe("integration routes — Linear", () => {
  beforeEach(async () => { await seed(); process.env.LINEAR_API_KEY = "lk"; });

  it("POST /integrations/linear/import imports issues into org-scoped Tasks", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2, ids: ["linear:i1", "linear:i2"] });
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(rows).toHaveLength(2);

    // Re-import is idempotent → 0 new.
    const res2 = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res2.json()).toEqual({ imported: 0, ids: [] });
    await app.close();
  });

  it("returns 400 when LINEAR_API_KEY is unset (no env-var-name leak)", async () => {
    delete process.env.LINEAR_API_KEY;
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oA" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("LINEAR_API_KEY");
    await app.close();
  });

  it("cross-org thread → 404", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/integrations/linear/import",
      headers: { "x-org-id": "oB" }, payload: { threadId: "tA" },
    });
    expect(res.statusCode).toBe(404);
    const rows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oB"));
    expect(rows).toHaveLength(0);
    await app.close();
  });
});
