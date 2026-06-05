import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerExecRoutes } from "./exec-routes.js";
import { orgs, workspaces, channels, threads, repos, members } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const TOKEN_ENV = "GH_TOKEN_EXEC_TEST";

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", defaultBranch: "main", tokenEnvVar: TOKEN_ENV,
  });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
  // thread with no repo (no token resolvable → 400)
  await h.db.insert(threads).values({ id: "tNoRepo", orgId: "oA", channelId: "cA", title: "T2" });
  // admin + member in org A
  await h.db.insert(members).values([
    { id: "adminA", orgId: "oA", workspaceId: "wA", displayName: "Admin", role: "admin" },
    { id: "memberA", orgId: "oA", workspaceId: "wA", displayName: "Member", role: "member" },
  ]);
}

function makeApp(calls: Array<Record<string, unknown>>, result = { output: "a.ts\nb.ts\n", exitCode: 0 }) {
  const app = Fastify();
  registerExecRoutes(app, {
    db: h.db,
    makeSandbox: () => ({
      exec: async (req: { repoUrl: string; baseBranch: string; command: string }) => {
        calls.push(req as unknown as Record<string, unknown>);
        return result;
      },
    }),
  });
  return app;
}

describe("exec routes", () => {
  beforeEach(() => { process.env[TOKEN_ENV] = "tok"; });

  it("admin POST /threads/:id/exec returns output + exitCode from the sandbox", async () => {
    await seed();
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls, { output: "a.ts\nb.ts\n", exitCode: 0 });
    const res = await app.inject({
      method: "POST", url: "/threads/tA/exec",
      headers: { "x-org-id": "oA", "x-user-id": "adminA" },
      payload: { command: "ls" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ output: "a.ts\nb.ts\n", exitCode: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ baseBranch: "main", command: "ls" });
    // repoUrl carries the token (constructed like the activity); not asserted here
    // beyond shape, but the credential must never leak in the response body.
    expect(res.body).not.toContain("tok");
    await app.close();
  });

  it("non-admin → 403 (arbitrary code exec is admin-gated)", async () => {
    await seed();
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/threads/tA/exec",
      headers: { "x-org-id": "oA", "x-user-id": "memberA" },
      payload: { command: "ls" },
    });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("cross-org thread → 404", async () => {
    await seed();
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/threads/tA/exec",
      headers: { "x-org-id": "oB", "x-user-id": "adminA" },
      payload: { command: "ls" },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("no repo token configured → 400", async () => {
    await seed();
    delete process.env[TOKEN_ENV];
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/threads/tA/exec",
      headers: { "x-org-id": "oA", "x-user-id": "adminA" },
      payload: { command: "ls" },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    expect(res.body).not.toContain(TOKEN_ENV);
    await app.close();
  });

  it("thread without a repo → 400 (no token resolvable)", async () => {
    await seed();
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/threads/tNoRepo/exec",
      headers: { "x-org-id": "oA", "x-user-id": "adminA" },
      payload: { command: "ls" },
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });

  it("missing command → 400", async () => {
    await seed();
    const calls: Array<Record<string, unknown>> = [];
    const app = makeApp(calls);
    const res = await app.inject({
      method: "POST", url: "/threads/tA/exec",
      headers: { "x-org-id": "oA", "x-user-id": "adminA" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await app.close();
  });
});
