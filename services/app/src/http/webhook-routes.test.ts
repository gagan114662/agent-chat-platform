import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerWebhookRoutes } from "./webhook-routes.js";
import { registerAuth } from "./auth-routes.js";
import { orgs, workspaces, channels, threads, repos, tasks } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const SECRET = "whsec-test-abc";

// A repo "acme/widgets" in org oA, wired to a thread (so Tasks can be opened),
// plus an org oB used to prove org-scoping. The webhook maps by (owner, name).
async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "g" });
  await h.db.insert(repos).values({
    id: "rA", orgId: "oA", workspaceId: "wA",
    githubOwner: "acme", githubName: "widgets", tokenEnvVar: "GH_TOKEN_A",
  });
  await h.db.insert(threads).values({ id: "tA", orgId: "oA", channelId: "cA", title: "T", repoId: "rA" });
}

function makeApp() {
  const app = Fastify();
  registerWebhookRoutes(app, { db: h.db, sql: h.sql });
  return app;
}

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function deliver(
  app: ReturnType<typeof makeApp>,
  event: string,
  payload: object,
  opts: { secret?: string; sigOverride?: string } = {},
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
  };
  const sig = opts.sigOverride ?? sign(body, opts.secret ?? SECRET);
  if (sig) headers["x-hub-signature-256"] = sig;
  return app.inject({ method: "POST", url: "/webhooks/github", headers, payload: body });
}

function issuesOpened(owner: string, name: string, number: number, title: string) {
  return {
    action: "opened",
    issue: { number, title },
    repository: { name, owner: { login: owner } },
  };
}

describe("POST /webhooks/github", () => {
  beforeEach(async () => { await seed(); process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET; });

  it("ping → 200 { ok: true }", async () => {
    const app = makeApp();
    const res = await deliver(app, "ping", { zen: "Keep it logically awesome." });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("issues.opened for a seeded repo → creates an idempotent org-mapped Task", async () => {
    const app = makeApp();
    const res = await deliver(app, "issues", issuesOpened("acme", "widgets", 7, "Broken thing"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, taskId: "gh:acme/widgets#7", created: true });

    const rows = await h.db.select().from(tasks).where(eq(tasks.id, "gh:acme/widgets#7"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: "oA", threadId: "tA", title: "#7 Broken thing",
      state: "open", createdByKind: "integration", createdById: "github",
    });

    // Re-deliver the exact same event (GitHub retries) → 0 new Tasks (idempotent).
    const again = await deliver(app, "issues", issuesOpened("acme", "widgets", 7, "Broken thing"));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: false });
    expect(await h.db.select().from(tasks).where(eq(tasks.id, "gh:acme/widgets#7"))).toHaveLength(1);

    await app.close();
  });

  it("unknown repo → 200 ignored (no Task, not an error)", async () => {
    const app = makeApp();
    const res = await deliver(app, "issues", issuesOpened("ghost", "nope", 1, "x"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(await h.db.select().from(tasks)).toHaveLength(0);
    await app.close();
  });

  it("other events → 200 ignored", async () => {
    const app = makeApp();
    const res = await deliver(app, "push", { ref: "refs/heads/main" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    await app.close();
  });

  it("non-opened issues action → 200 ignored", async () => {
    const app = makeApp();
    const res = await deliver(app, "issues", { ...issuesOpened("acme", "widgets", 9, "x"), action: "closed" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(await h.db.select().from(tasks)).toHaveLength(0);
    await app.close();
  });

  it("bad signature (tampered body) → 401, no Task", async () => {
    const app = makeApp();
    // Sign the original, then mutate the payload so the HMAC no longer matches.
    const goodBody = JSON.stringify(issuesOpened("acme", "widgets", 11, "real"));
    const sig = sign(goodBody);
    const tampered = JSON.stringify(issuesOpened("acme", "widgets", 11, "EVIL"));
    const res = await app.inject({
      method: "POST", url: "/webhooks/github",
      headers: { "content-type": "application/json", "x-github-event": "issues", "x-hub-signature-256": sig },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
    expect(await h.db.select().from(tasks)).toHaveLength(0);
    await app.close();
  });

  it("wrong secret → 401", async () => {
    const app = makeApp();
    const res = await deliver(app, "issues", issuesOpened("acme", "widgets", 12, "x"), { secret: "wrong" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("missing signature header → 401", async () => {
    const app = makeApp();
    const res = await deliver(app, "ping", { zen: "x" }, { sigOverride: "" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("401 when GITHUB_APP_WEBHOOK_SECRET is unset", async () => {
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    const app = makeApp();
    const res = await deliver(app, "ping", { zen: "x" });
    expect(res.statusCode).toBe(401);
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    await app.close();
  });

  // Production auth path (#37): dev-headers OFF. The user-session preHandler must
  // NOT 401 /webhooks/* (machine-to-machine); the HMAC still gates.
  it("with the user-auth preHandler and dev-headers OFF: preHandler bypassed, HMAC gates", async () => {
    const prevDev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = Fastify();
      registerAuth(app, { db: h.db });
      registerWebhookRoutes(app, { db: h.db, sql: h.sql });
      await app.ready();

      // No session token → preHandler would 401 a normal route, but /webhooks/*
      // bypasses it; the valid HMAC then lets the request through.
      const ok = await deliver(app, "issues", issuesOpened("acme", "widgets", 21, "via prod path"));
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ taskId: "gh:acme/widgets#21", created: true });

      // Bad signature → the route's own 401 (not the preHandler's).
      const bad = await deliver(app, "issues", issuesOpened("acme", "widgets", 22, "x"), { secret: "wrong" });
      expect(bad.statusCode).toBe(401);

      await app.close();
    } finally {
      if (prevDev === undefined) delete process.env.ACP_ALLOW_DEV_HEADERS;
      else process.env.ACP_ALLOW_DEV_HEADERS = prevDev;
    }
  });
});
