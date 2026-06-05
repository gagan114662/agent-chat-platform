import { describe, it, expect, afterAll, beforeEach } from "vitest";
import Fastify from "fastify";
import { testDb, closeDb } from "../db/test-harness.js";
import { registerAuth } from "./auth-routes.js";
import { registerContactRoutes } from "./contact-routes.js";
import { _reset } from "../auth/rate-limit.js";
import { contacts } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

function makeApp() {
  const app = Fastify();
  registerAuth(app, { db: h.db });
  registerContactRoutes(app, { db: h.db });
  return app;
}

beforeEach(async () => {
  _reset();
  await h.reset();
});

const json = { "content-type": "application/json" };

describe("contact-form backend (#69)", () => {
  it("POST /contact with valid fields → 200 + a contacts row", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/contact", headers: json,
      payload: { name: "Ada", email: "ada@example.com", website: "https://ada.dev", help: "Need agents." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await h.db.select().from(contacts);
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe("ada@example.com");
    expect(rows[0].name).toBe("Ada");
    expect(rows[0].website).toBe("https://ada.dev");
    expect(rows[0].help).toBe("Need agents.");
    await app.close();
  });

  it("POST /contact with missing email → 400 and no row", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/contact", headers: json,
      payload: { name: "NoEmail" },
    });
    expect(res.statusCode).toBe(400);
    const rows = await h.db.select().from(contacts);
    expect(rows.length).toBe(0);
    await app.close();
  });

  it("POST /contact rejects an over-long field → 400", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST", url: "/contact", headers: json,
      payload: { name: "x".repeat(5000), email: "a@b.io" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("POST /contact is PUBLIC — reachable without auth (no 401 in strict mode)", async () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = makeApp();
      const res = await app.inject({
        method: "POST", url: "/contact", headers: json,
        payload: { name: "Anon", email: "anon@example.com" },
      });
      // The marketing form is public: it must NOT be rejected by the session 401.
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).toBe(200);
      await app.close();
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  });
});
