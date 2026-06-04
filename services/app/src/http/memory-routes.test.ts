import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerMemoryRoutes } from "./memory-routes.js";
import { orgs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
function makeApp() { const app = Fastify(); registerMemoryRoutes(app, { db: h.db }); return app; }
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("memory routes", () => {
  it("POST creates a node; GET lists + filters; stats counts", async () => {
    const app = makeApp();
    const created = await app.inject({ method: "POST", url: "/memory", headers: { "x-org-id": "o1", "content-type": "application/json" }, payload: { kind: "fact", label: "uses postgres" } });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/memory?kind=fact", headers: { "x-org-id": "o1" } });
    expect(list.json().map((n: { label: string }) => n.label)).toContain("uses postgres");
    const stats = await app.inject({ method: "GET", url: "/memory/stats", headers: { "x-org-id": "o1" } });
    expect(stats.json()).toEqual({ nodes: 1, edges: 0 });
    await app.close();
  });
});
