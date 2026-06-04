import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials } from "../auth/auth.js";
import { roleOf } from "../rbac/rbac.js";
import { devHeadersAllowed } from "../auth/dev-mode.js";
import { issueWsTicket } from "../realtime/ws-tickets.js";
import { allow } from "../auth/rate-limit.js";

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

// registerAuth adds a root preHandler that resolves the bearer token into req.principal,
// plus the /auth/* routes. Must be registered BEFORE other route registrars so the
// preHandler covers them.
export function registerAuth(app: FastifyInstance, d: { db: DB }) {
  const PUBLIC_PATHS = new Set(["/auth/login", "/auth/members", "/healthz"]);
  app.addHook("preHandler", async (req, reply) => {
    const token = bearer(req);
    if (token) {
      const p = await resolveSession(d.db, token);
      if (p) req.principal = p;
    }
    if (!devHeadersAllowed() && !req.principal) {
      // strip query string for the public-path check
      const path = req.url.split("?")[0];
      // /ingest/* is machine-to-machine (its own x-acp-ingest-secret guard);
      // /webhooks/* is machine-to-machine too (its own X-Hub-Signature-256 HMAC).
      // Both must bypass the user-session 401 here, NOT be left unauthenticated.
      if (!PUBLIC_PATHS.has(path) && !path.startsWith("/ingest/") && !path.startsWith("/webhooks/")) {
        return reply.code(401).send({ error: "unauthenticated" });
      }
    }
  });

  app.get("/auth/members", async (_req, reply) => {
    if (!devHeadersAllowed()) return reply.code(404).send({ error: "not found" });
    return listMembersForLogin(d.db);
  });

  app.post("/auth/login", async (req, reply) => {
    const { memberId, password } = req.body as { memberId: string; password?: string };
    // Throttle brute-force BEFORE any credential check (per ip+member, 5/min).
    if (!allow(`${req.ip}:${memberId}`)) {
      return reply.code(429).send({ error: "too many attempts" });
    }
    const strict = !devHeadersAllowed();
    if (strict) {
      if (!password || !(await verifyCredentials(d.db, memberId, password))) {
        return reply.code(401).send({ error: "invalid credentials" });
      }
    }
    try {
      const { token, member } = await createSession(d.db, memberId);
      return reply.code(201).send({ token, member });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "unauthenticated" });
    const role = await roleOf(d.db, req.principal.userId, req.principal.orgId);
    return { ...req.principal, role };
  });

  // Issues a short-lived single-use WS ticket so the token never rides in the WS URL.
  // Sits behind the same preHandler. In dev-headers mode there may be no real
  // principal — then return 400 so dev clients fall back to the token/header WS path.
  app.post("/ws-ticket", async (req, reply) => {
    if (!req.principal) {
      if (devHeadersAllowed()) return reply.code(400).send({ error: "no session" });
      return reply.code(401).send({ error: "unauthenticated" });
    }
    return { ticket: issueWsTicket(req.principal) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = bearer(req);
    if (token) await deleteSession(d.db, token);
    return reply.code(204).send();
  });
}
