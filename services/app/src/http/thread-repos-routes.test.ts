import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerThreadReposRoutes } from "./thread-repos-routes.js";
import { orgs, workspaces, channels, repos } from "../db/schema.js";
import { createThread } from "../nav/nav.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerThreadReposRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values([
    { id: "wA", orgId: "oA", name: "WA" },
    { id: "wB", orgId: "oB", name: "WB" },
  ]);
  await h.db.insert(channels).values([
    { id: "cA", orgId: "oA", workspaceId: "wA", name: "general" },
    { id: "cB", orgId: "oB", workspaceId: "wB", name: "general" },
  ]);
  await h.db.insert(repos).values([
    { id: "rA1", orgId: "oA", workspaceId: "wA", githubOwner: "o", githubName: "r1", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" },
    { id: "rA2", orgId: "oA", workspaceId: "wA", githubOwner: "o", githubName: "r2", defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" },
  ]);
});

const hA = { "x-org-id": "oA", "x-user-id": "mA" };
const hB = { "x-org-id": "oB", "x-user-id": "mB" };

describe("thread repos routes", () => {
  it("POST /threads/:id/repos adds a repo; GET lists both (primary first)", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });

    const add = await app.inject({
      method: "POST", url: `/threads/${t.id}/repos`,
      headers: hA, payload: { repoId: "rA2" },
    });
    expect(add.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: `/threads/${t.id}/repos`, headers: hA });
    expect(list.statusCode).toBe(200);
    const rows = list.json();
    expect(rows.map((r: { repoId: string }) => r.repoId)).toEqual(["rA1", "rA2"]);
    expect(rows.filter((r: { isPrimary: boolean }) => r.isPrimary).map((r: { repoId: string }) => r.repoId)).toEqual(["rA1"]);
    await app.close();
  });

  it("POST with isPrimary flips the primary flag", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await app.inject({ method: "POST", url: `/threads/${t.id}/repos`, headers: hA, payload: { repoId: "rA2", isPrimary: true } });
    const rows = (await app.inject({ method: "GET", url: `/threads/${t.id}/repos`, headers: hA })).json();
    expect(rows.filter((r: { isPrimary: boolean }) => r.isPrimary).map((r: { repoId: string }) => r.repoId)).toEqual(["rA2"]);
    await app.close();
  });

  it("DELETE /threads/:id/repos/:repoId removes a repo (cross-org → 404)", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    await app.inject({ method: "POST", url: `/threads/${t.id}/repos`, headers: hA, payload: { repoId: "rA2" } });

    const cross = await app.inject({ method: "DELETE", url: `/threads/${t.id}/repos/rA2`, headers: hB });
    expect(cross.statusCode).toBe(404);

    const ok = await app.inject({ method: "DELETE", url: `/threads/${t.id}/repos/rA2`, headers: hA });
    expect(ok.statusCode).toBe(204);

    const rows = (await app.inject({ method: "GET", url: `/threads/${t.id}/repos`, headers: hA })).json();
    expect(rows.map((r: { repoId: string }) => r.repoId)).toEqual(["rA1"]);
    await app.close();
  });

  it("POST /threads/:id/fork creates a new thread copying the repo set", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "orig", repoId: "rA1" });
    await app.inject({ method: "POST", url: `/threads/${t.id}/repos`, headers: hA, payload: { repoId: "rA2" } });

    const fork = await app.inject({ method: "POST", url: `/threads/${t.id}/fork`, headers: hA });
    expect(fork.statusCode).toBe(201);
    const body = fork.json();
    expect(body.id).not.toBe(t.id);
    expect(body.forkedFrom).toBe(t.id);
    expect(body.title).toBe("Fork of orig");
    expect(body.repoId).toBe("rA1");

    const rows = (await app.inject({ method: "GET", url: `/threads/${body.id}/repos`, headers: hA })).json();
    expect(rows.map((r: { repoId: string }) => r.repoId).sort()).toEqual(["rA1", "rA2"]);
    await app.close();
  });

  it("cross-org thread → 404 on add, list (empty), and fork", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "orig", repoId: "rA1" });

    const add = await app.inject({ method: "POST", url: `/threads/${t.id}/repos`, headers: hB, payload: { repoId: "rA2" } });
    expect(add.statusCode).toBe(404);

    const list = await app.inject({ method: "GET", url: `/threads/${t.id}/repos`, headers: hB });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);

    const fork = await app.inject({ method: "POST", url: `/threads/${t.id}/fork`, headers: hB });
    expect(fork.statusCode).toBe(404);
    await app.close();
  });

  it("POST /threads/:id/repos requires repoId", async () => {
    const app = makeApp();
    const t = await createThread(h.db, { orgId: "oA", channelId: "cA", title: "fix", repoId: "rA1" });
    const res = await app.inject({ method: "POST", url: `/threads/${t.id}/repos`, headers: hA, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
