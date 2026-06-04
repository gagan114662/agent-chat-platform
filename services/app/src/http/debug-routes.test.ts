import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerDebugRoutes } from "./debug-routes.js";
import { orgs, runs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(runs).values([
    { id: "rFailA", orgId: "oA", taskId: "t1", state: "checks_failed", workflowId: "w" },
    { id: "rFailB", orgId: "oB", taskId: "t2", state: "checks_failed", workflowId: "w" },
  ]);
}

function makeApp() {
  const app = Fastify();
  registerDebugRoutes(app, { db: h.db });
  return app;
}

describe("debug routes", () => {
  beforeEach(seed);

  it("POST /debug/query returns an answer", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/debug/query",
      headers: { "x-org-id": "oA" },
      payload: { question: "what's failing?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("recent-failures");
    expect((body.data as { id: string }[]).map((r) => r.id)).toEqual(["rFailA"]);
    await app.close();
  });

  it("is org-scoped — org B does not see org A's failures", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/debug/query",
      headers: { "x-org-id": "oB" },
      payload: { question: "what's failing?" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as { id: string }[]).map((r) => r.id)).toEqual(["rFailB"]);
    await app.close();
  });

  it("rejects an empty question (400)", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/debug/query",
      headers: { "x-org-id": "oA" },
      payload: { question: "" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
