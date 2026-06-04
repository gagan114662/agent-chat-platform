import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerLogIngestRoutes } from "./log-ingest-routes.js";
import { registerAuth } from "./auth-routes.js";
import { orgs, incidents, logEvents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const SECRET = "ingest-secret-xyz";

const BATCH = [
  `{"level":"error","message":"db down: connection refused"}`,
  `WARN disk almost full`,
  `{not valid json`,
  `{"level":"info","message":"started ok"}`,
].join("\n");

async function seed() {
  await h.reset();
  await h.db.insert(orgs).values([{ id: "oA", name: "A" }, { id: "oB", name: "B" }]);
}

function makeApp() {
  const app = Fastify();
  registerLogIngestRoutes(app, { db: h.db, sql: h.sql });
  return app;
}

function post(app: ReturnType<typeof makeApp>, url: string, body: string, secret?: string) {
  const headers: Record<string, string> = { "content-type": "text/plain" };
  if (secret !== undefined) headers["x-acp-ingest-secret"] = secret;
  return app.inject({ method: "POST", url, headers, payload: body });
}

describe("POST /ingest/logs/:source/:orgId", () => {
  beforeEach(async () => { await seed(); process.env.ACP_INGEST_SECRET = SECRET; });

  it("parses + stores log_events, derives incidents, idempotent on re-POST", async () => {
    const app = makeApp();
    const res = await post(app, "/ingest/logs/app/oA", BATCH, SECRET);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 3 parseable lines (malformed skipped): error + warn + info
    expect(body.ingested).toBeGreaterThanOrEqual(1);
    expect(body.incidents).toBeGreaterThanOrEqual(1);

    const logRows = await h.db.select().from(logEvents).where(eq(logEvents.orgId, "oA"));
    expect(logRows.length).toBe(3);
    expect(logRows.every((r) => r.source === "app")).toBe(true);
    expect(logRows.some((r) => r.level === "error")).toBe(true);

    const incRows = await h.db.select().from(incidents).where(eq(incidents.orgId, "oA"));
    expect(incRows.length).toBeGreaterThanOrEqual(1);
    expect(incRows.every((r) => r.source === "log:app")).toBe(true);

    // Re-POST → incidents idempotent (0 new). log_events accumulate (append-only).
    const res2 = await post(app, "/ingest/logs/app/oA", BATCH, SECRET);
    expect(res2.statusCode).toBe(200);
    expect(res2.json().incidents).toBe(0);
    expect(await h.db.select().from(incidents).where(eq(incidents.orgId, "oA")))
      .toHaveLength(incRows.length);

    await app.close();
  });

  it("401 on missing or wrong ingest secret", async () => {
    const app = makeApp();
    expect((await post(app, "/ingest/logs/app/oA", BATCH)).statusCode).toBe(401);
    expect((await post(app, "/ingest/logs/app/oA", BATCH, "nope")).statusCode).toBe(401);
    expect(await h.db.select().from(logEvents).where(eq(logEvents.orgId, "oA"))).toHaveLength(0);
    await app.close();
  });

  it("401 when ACP_INGEST_SECRET is unset", async () => {
    delete process.env.ACP_INGEST_SECRET;
    const app = makeApp();
    const res = await post(app, "/ingest/logs/app/oA", BATCH, SECRET);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("404 on unknown org", async () => {
    const app = makeApp();
    const res = await post(app, "/ingest/logs/app/ghost", BATCH, SECRET);
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("413 when the body exceeds the cap", async () => {
    const app = makeApp();
    const big = "x".repeat(6 * 1024 * 1024); // 6 MiB > 5 MiB cap
    const res = await post(app, "/ingest/logs/app/oA", big, SECRET);
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it("with the user-auth preHandler and dev-headers OFF: preHandler does not block, secret gates", async () => {
    const prevDev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = Fastify();
      registerAuth(app, { db: h.db });
      registerLogIngestRoutes(app, { db: h.db, sql: h.sql });
      await app.ready();

      const ok = await post(app, "/ingest/logs/app/oA", BATCH, SECRET);
      expect(ok.statusCode).toBe(200);

      const bad = await post(app, "/ingest/logs/app/oA", BATCH, "nope");
      expect(bad.statusCode).toBe(401);
      await app.close();
    } finally {
      if (prevDev === undefined) delete process.env.ACP_ALLOW_DEV_HEADERS;
      else process.env.ACP_ALLOW_DEV_HEADERS = prevDev;
    }
  });
});
