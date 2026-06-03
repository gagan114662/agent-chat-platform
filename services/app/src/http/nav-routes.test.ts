import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerNavRoutes } from "./nav-routes.js";
import { orgs, workspaces, channels, repos } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerNavRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" });
});

describe("nav routes", () => {
  it("GET /channels returns org channels", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/channels", headers: { "x-org-id": "o1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { name: string }) => c.name)).toContain("general");
    await app.close();
  });

  it("GET /repos returns org repos", async () => {
    const app = makeApp();
    const res = await app.inject({ method: "GET", url: "/repos", headers: { "x-org-id": "o1" } });
    expect(res.json().map((r: { id: string }) => r.id)).toEqual(["r1"]);
    await app.close();
  });

  it("POST /channels/:id/threads creates and GET lists it", async () => {
    const app = makeApp();
    const created = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { title: "fix login", repoId: "r1" },
    });
    expect(created.statusCode).toBe(201);
    const tid = created.json().id as string;
    const list = await app.inject({ method: "GET", url: "/channels/c1/threads", headers: { "x-org-id": "o1" } });
    expect(list.json().map((t: { id: string }) => t.id)).toContain(tid);
    await app.close();
  });

  it("POST with a foreign repo 400s", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/channels/c1/threads",
      headers: { "x-org-id": "o1", "content-type": "application/json" },
      payload: { title: "x", repoId: "does-not-exist" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
