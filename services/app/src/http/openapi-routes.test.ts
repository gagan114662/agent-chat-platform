import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerAuth } from "./auth-routes.js";
import { registerOpenApiRoutes } from "./openapi-routes.js";

// Build an app WITH the auth preHandler so we prove /openapi.json + /docs are
// public (bypass the session 401) even with no Authorization header. We force
// strict mode by clearing ACP_ALLOW_DEV_HEADERS (set to "1" by the vitest config)
// so the preHandler actually enforces the 401 default-deny. No DB is needed: with
// no bearer token the preHandler never touches the db.
function makeApp() {
  const app = Fastify();
  registerAuth(app, { db: {} as never });
  registerOpenApiRoutes(app);
  return app;
}

describe("openapi routes (#86)", () => {
  it("GET /openapi.json returns a valid OpenAPI 3 spec, publicly (no auth)", async () => {
    const prev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS; // strict: preHandler enforces auth
    try {
      const app = makeApp();
      const res = await app.inject({ method: "GET", url: "/openapi.json" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      const spec = res.json();
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info.title).toBe("agent-chat-platform API");
      expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
      expect(Object.keys(spec.paths).length).toBeGreaterThanOrEqual(8);
      await app.close();
    } finally {
      if (prev !== undefined) process.env.ACP_ALLOW_DEV_HEADERS = prev;
    }
  });

  it("GET /docs returns HTML referencing /openapi.json, publicly (no auth)", async () => {
    const prev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = makeApp();
      const res = await app.inject({ method: "GET", url: "/docs" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.body).toContain("/openapi.json");
      expect(res.body.toLowerCase()).toContain("swagger");
      await app.close();
    } finally {
      if (prev !== undefined) process.env.ACP_ALLOW_DEV_HEADERS = prev;
    }
  });

  it("a non-public route still 401s without auth (proves the preHandler is active)", async () => {
    const prev = process.env.ACP_ALLOW_DEV_HEADERS;
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      const app = makeApp();
      const res = await app.inject({ method: "GET", url: "/some-protected-thing" });
      expect(res.statusCode).toBe(401);
      await app.close();
    } finally {
      if (prev !== undefined) process.env.ACP_ALLOW_DEV_HEADERS = prev;
    }
  });
});
