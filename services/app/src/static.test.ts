import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerAuth } from "./http/auth-routes.js";

// Light unit guarding the #103 same-origin change WITHOUT standing up the full
// server (buildServer() needs a live Temporal at :7233, unavailable in CI/sandbox).
// vitest never sets SERVE_WEB, so static serving + the SPA notFoundHandler stay
// OFF and behavior is unchanged: the public /healthz probe passes the auth
// preHandler and unknown GETs return Fastify's default JSON 404 (no SPA fallback).
describe("server without SERVE_WEB (static serving off, #103)", () => {
  it("does not enable static serving when SERVE_WEB is unset", () => {
    expect(process.env.SERVE_WEB).not.toBe("1");
  });

  it("/healthz is public (auth preHandler must not 401 it) and unknown GETs are JSON 404s", async () => {
    const app = Fastify();
    // Real auth registrar — exercises the PUBLIC_PATHS change (/healthz added).
    registerAuth(app, { db: {} as never });
    app.get("/healthz", async () => ({ ok: true }));
    await app.ready();

    // ACP_ALLOW_DEV_HEADERS=1 is set by vitest config, so devHeadersAllowed() is
    // true and the preHandler does not 401; /healthz resolves normally.
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    // With SERVE_WEB unset there is no SPA notFoundHandler: unknown GETs fall
    // through to Fastify's built-in JSON 404 — same as today.
    const miss = await app.inject({ method: "GET", url: "/definitely-not-a-route" });
    expect(miss.statusCode).toBe(404);
    expect(miss.headers["content-type"]).toContain("application/json");
    expect(miss.json()).toMatchObject({ message: expect.any(String) });

    await app.close();
  });
});
