import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials } from "../auth/auth.js";
import { roleOf } from "../rbac/rbac.js";
import { devHeadersAllowed } from "../auth/dev-mode.js";
import { resolveApiKey } from "../auth/api-keys.js";
import { issueWsTicket } from "../realtime/ws-tickets.js";
import { allow } from "../auth/rate-limit.js";

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

// #80: the signed file content/download routes carry their own HMAC `?sig=` token
// (verified in file-storage-routes), so the user-session preHandler must let them
// through. Matches `/files/<id>/content` and `/files/<id>/download` ONLY — the bare
// `/files` (create) and `/files/<id>` (metadata) routes still require a session.
function isSignedFilePath(path: string): boolean {
  return /^\/files\/[^/]+\/(content|download)$/.test(path);
}

// registerAuth adds a root preHandler that resolves the bearer token into req.principal,
// plus the /auth/* routes. Must be registered BEFORE other route registrars so the
// preHandler covers them.
export function registerAuth(app: FastifyInstance, d: { db: DB }) {
  // #88 invites: accepting an invite is token-gated, not session-gated — a new
  // user has no session yet. So /invites/accept is public (bypasses the session
  // 401 here) like /auth/login; the route itself validates the invite token.
  const PUBLIC_PATHS = new Set(["/auth/login", "/auth/members", "/healthz", "/invites/accept"]);
  app.addHook("preHandler", async (req, reply) => {
    const token = bearer(req);
    if (token) {
      // #83 api keys: an `acp_`-prefixed bearer resolves as an API-key principal
      // (revocable, org-scoped) BEFORE session resolution. An invalid/revoked key
      // yields no principal → falls through → #37 fail-closed default-deny.
      if (token.startsWith("acp_")) {
        const p = await resolveApiKey(d.db, token);
        if (p) req.principal = p;
      } else {
        const p = await resolveSession(d.db, token);
        if (p) req.principal = p;
      }
    }
    if (!devHeadersAllowed() && !req.principal) {
      // strip query string for the public-path check
      const path = req.url.split("?")[0];
      // /ingest/* is machine-to-machine (its own x-acp-ingest-secret guard);
      // /webhooks/* is machine-to-machine too (its own X-Hub-Signature-256 HMAC).
      // Both must bypass the user-session 401 here, NOT be left unauthenticated.
      // #80 signed file content/download (PUT /files/:id/content, GET
      // /files/:id/download) authenticate via an HMAC `?sig=` token enforced in the
      // route, so they bypass the session 401 here too (the route verifies the sig).
      // POST /files and GET /files/:id (metadata) stay under normal auth.
      if (!PUBLIC_PATHS.has(path) && !path.startsWith("/ingest/") && !path.startsWith("/webhooks/")
          && !isSignedFilePath(path)) {
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
