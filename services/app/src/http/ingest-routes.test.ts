import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { and, eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerIngestRoutes } from "./ingest-routes.js";
import { registerAuth } from "./auth-routes.js";
import { orgs, workspaces, channels, threads, tasks, incidents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const SECRET = "ingest-secret-xyz";

const BATCH = [
  `{"Action":"block","ClientIP":"1.1.1.1"}`,
  `{"Action":"block","ClientIP":"2.2.2.2"}`,
  `{"Action":"block","ClientIP":"3.3.3.3"}`,
  `{"Action":"allow","ClientIP":"9.9.9.9"}`,
  `not-valid-json`,
  `{"ActionType":"token.delete","id":"audit-1"}`,
].join("\n");

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
  await h.db.insert(workspaces).values({ id: "wA", orgId: "oA", name: "W" });
  await h.db.insert(channels).values({ id: "cA", orgId: "oA", workspaceId: "wA", name: "security" });
  await h.db.insert(threads).values({ id: "secA", orgId: "oA", channelId: "cA", title: "Security" });
}

function makeApp() {
  const app = Fastify();
  registerIngestRoutes(app, { db: h.db, sql: h.sql });
  return app;
}

function post(app: ReturnType<typeof makeApp>, url: string, body: string, secret?: string) {
  const headers: Record<string, string> = { "content-type": "text/plain" };
  if (secret !== undefined) headers["x-acp-ingest-secret"] = secret;
  return app.inject({ method: "POST", url, headers, payload: body });
}

describe("POST /ingest/cloudflare/:orgId", () => {
  beforeEach(async () => { await seed(); process.env.ACP_INGEST_SECRET = SECRET; });

  it("parses + detects → records incidents and opens Tasks (idempotent on re-POST)", async () => {
    const app = makeApp();
    const res = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, SECRET);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // one WAF incident (3 blocks) + one audit incident = 2 incidents + 2 tasks
    expect(body.incidents).toBe(2);
    expect(body.tasks).toBe(2);

    const incRows = await h.db.select().from(incidents).where(eq(incidents.orgId, "oA"));
    expect(incRows).toHaveLength(2);
    const waf = incRows.find((r) => r.id.includes(":cf-waf:"));
    expect(waf).toBeTruthy();
    expect(waf!.severity).toBe("medium");
    expect(waf!.title).toBe("WAF blocked 3 requests");
    expect(waf!.taskId).toBeTruthy();
    const audit = incRows.find((r) => r.id.includes(":cf-audit:audit-1"));
    expect(audit!.severity).toBe("high");

    const taskRows = await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"));
    expect(taskRows).toHaveLength(2);
    expect(taskRows.every((t) => t.threadId === "secA")).toBe(true);

    // Re-POST the same batch → 0 new (deterministic ids + onConflictDoNothing).
    const res2 = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, SECRET);
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toEqual({ incidents: 0, tasks: 0 });
    expect(await h.db.select().from(incidents).where(eq(incidents.orgId, "oA"))).toHaveLength(2);
    expect(await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"))).toHaveLength(2);

    await app.close();
  });

  it("records incidents even without a threadId (no Task created)", async () => {
    const app = makeApp();
    const res = await post(app, "/ingest/cloudflare/oA", BATCH, SECRET);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ incidents: 2, tasks: 0 });
    const incRows = await h.db.select().from(incidents).where(eq(incidents.orgId, "oA"));
    expect(incRows).toHaveLength(2);
    expect(incRows.every((r) => r.taskId === null)).toBe(true);
    expect(await h.db.select().from(tasks).where(eq(tasks.orgId, "oA"))).toHaveLength(0);
    await app.close();
  });

  it("401 on missing or wrong ingest secret", async () => {
    const app = makeApp();
    const missing = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH);
    expect(missing.statusCode).toBe(401);
    const wrong = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, "nope");
    expect(wrong.statusCode).toBe(401);
    // nothing recorded
    expect(await h.db.select().from(incidents).where(eq(incidents.orgId, "oA"))).toHaveLength(0);
    await app.close();
  });

  it("401 when ACP_INGEST_SECRET is unset", async () => {
    delete process.env.ACP_INGEST_SECRET;
    const app = makeApp();
    const res = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, SECRET);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404 on unknown org", async () => {
    const app = makeApp();
    const res = await post(app, "/ingest/cloudflare/ghost?threadId=secA", BATCH, SECRET);
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("404 when threadId belongs to another org (org-scoped)", async () => {
    const app = makeApp();
    // secA is org oA; posting under oB with threadId=secA must not leak it.
    const res = await post(app, "/ingest/cloudflare/oB?threadId=secA", BATCH, SECRET);
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("413 when the body exceeds the cap", async () => {
    const app = makeApp();
    const big = "x".repeat(6 * 1024 * 1024); // 6 MiB > 5 MiB cap
    const res = await post(app, "/ingest/cloudflare/oA?threadId=secA", big, SECRET);
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  // Production auth path (#37): dev-headers OFF. The user-session preHandler must
  // NOT 401 /ingest/* (it's machine-to-machine), but the ingest secret still gates.
  it("with the user-auth preHandler and dev-headers OFF: preHandler does not block, secret gates", async () => {
    const prevDev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = Fastify();
      registerAuth(app, { db: h.db });           // adds the fail-closed preHandler
      registerIngestRoutes(app, { db: h.db, sql: h.sql });
      await app.ready();

      // No session token at all → preHandler would 401 a normal route, but
      // /ingest/* bypasses it; the valid secret then lets the request through.
      const ok = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, SECRET);
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ incidents: 2, tasks: 2 });

      // Wrong secret → the route's own 401 (not the preHandler's).
      const bad = await post(app, "/ingest/cloudflare/oA?threadId=secA", BATCH, "nope");
      expect(bad.statusCode).toBe(401);

      await app.close();
    } finally {
      if (prevDev === undefined) delete process.env.ACP_ALLOW_DEV_HEADERS;
      else process.env.ACP_ALLOW_DEV_HEADERS = prevDev;
    }
  });
});
