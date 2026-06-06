import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials } from "../auth/auth.js";
import { requestMagicLink, verifyMagicLink, peekMagicLinkMember } from "../auth/magic-link.js";
import { enrollMfa, confirmMfa, disableMfa, mfaRequired, verifyMfaCode } from "../auth/mfa.js";
import { googleAuthUrl, handleGoogleCallback } from "../auth/google-sso.js";
import { randomUUID } from "node:crypto";
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
  // #84 magic-link: requesting a link and verifying it are token-gated, not
  // session-gated (the user has no session yet), so both are public like
  // /auth/login; the routes themselves validate the email/token.
  // #84 Google SSO: starting the OAuth flow and handling the callback are
  // token-gated by Google (the user has no app session yet), so both are public
  // like /auth/login; the routes validate the code/state themselves.
  const PUBLIC_PATHS = new Set([
    "/auth/login", "/auth/members", "/healthz", "/invites/accept",
    "/auth/magic-link/request", "/auth/magic-link/verify",
    "/auth/google", "/auth/google/callback",
    // #86 public API discovery: the OpenAPI spec + Swagger UI docs page.
    "/openapi.json", "/docs",
    // #69 public marketing contact form: anonymous landing visitors submit a
    // lead — no session/org. The route validates the payload itself.
    "/contact",
  ]);
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
      // /public/* is the customer-facing surface (e.g. opening a Stripe Checkout
      // Session for a quote) — no user session; the quote id is the capability.
      if (!PUBLIC_PATHS.has(path) && !path.startsWith("/ingest/") && !path.startsWith("/webhooks/")
          && !path.startsWith("/public/") && !isSignedFilePath(path)) {
        return reply.code(401).send({ error: "unauthenticated" });
      }
    }
  });

  app.get("/auth/members", async (_req, reply) => {
    if (!devHeadersAllowed()) return reply.code(404).send({ error: "not found" });
    return listMembersForLogin(d.db);
  });

  app.post("/auth/login", async (req, reply) => {
    const { memberId, password, code } = req.body as { memberId: string; password?: string; code?: string };
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
    // #84 TOTP MFA gate: if this member has MFA enabled, a valid `code` is required
    // (401 if absent/wrong). MFA off by default → existing logins unchanged.
    if (await mfaRequired(d.db, memberId)) {
      if (!(await verifyMfaCode(d.db, memberId, code))) {
        return reply.code(401).send({ error: code ? "invalid code" : "mfa required" });
      }
    }
    try {
      const { token, member } = await createSession(d.db, memberId);
      return reply.code(201).send({ token, member });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // #84 PUBLIC: request a magic link. ALWAYS responds 200 regardless of whether
  // the email matches a member (no user enumeration). The plaintext token is
  // returned in the body ONLY when dev headers are allowed (local/dev/test) so
  // prod never leaks it — prod delivers it via email (a thin follow-up).
  app.post("/auth/magic-link/request", async (req, reply) => {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) return reply.code(400).send({ error: "email required" });
    const { token } = await requestMagicLink(d.db, { email });
    // Only surface the plaintext token in dev; prod responds 200 with no token.
    if (devHeadersAllowed() && token) return reply.code(200).send({ ok: true, token });
    return reply.code(200).send({ ok: true });
  });

  // #84 PUBLIC: verify a magic link → a session + member. An invalid/expired/
  // already-used token → 401 (single-use, 15min TTL enforced in verifyMagicLink).
  app.post("/auth/magic-link/verify", async (req, reply) => {
    const { token, code } = req.body as { token?: string; code?: string };
    if (!token) return reply.code(401).send({ error: "invalid or expired" });
    // #84 TOTP MFA gate: if the member behind this (unconsumed) token has MFA
    // enabled, require a valid `code` BEFORE consuming the single-use link — a
    // failed MFA attempt must not burn the token.
    const peekMemberId = await peekMagicLinkMember(d.db, { token });
    if (peekMemberId && (await mfaRequired(d.db, peekMemberId))) {
      if (!(await verifyMfaCode(d.db, peekMemberId, code))) {
        return reply.code(401).send({ error: code ? "invalid code" : "mfa required" });
      }
    }
    try {
      const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
      const { token: sessionToken, member } = await verifyMagicLink(d.db, { token, userAgent: ua });
      return reply.code(200).send({
        token: sessionToken,
        member: { id: member.id, orgId: member.orgId, workspaceId: member.workspaceId, displayName: member.displayName, role: member.role },
      });
    } catch {
      return reply.code(401).send({ error: "invalid or expired" });
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

  // #84 TOTP MFA — authed (behind the session preHandler). Enroll mints a secret
  // (+ otpauth URI for the QR) but does NOT enable MFA; confirm with a valid code
  // enables it; disable clears it.
  app.post("/auth/mfa/enroll", async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "unauthenticated" });
    const { secret, uri } = await enrollMfa(d.db, { orgId: req.principal.orgId, memberId: req.principal.userId });
    return reply.code(200).send({ secret, uri });
  });

  app.post("/auth/mfa/confirm", async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "unauthenticated" });
    const { code } = req.body as { code?: string };
    try {
      await confirmMfa(d.db, { orgId: req.principal.orgId, memberId: req.principal.userId, code: code ?? "" });
      return reply.code(200).send({ ok: true, mfaEnabled: true });
    } catch {
      return reply.code(401).send({ error: "invalid code" });
    }
  });

  app.post("/auth/mfa/disable", async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "unauthenticated" });
    await disableMfa(d.db, { orgId: req.principal.orgId, memberId: req.principal.userId });
    return reply.code(200).send({ ok: true, mfaEnabled: false });
  });

  // #84 Google SSO — PUBLIC. GET /auth/google redirects (302) to Google's consent
  // screen with a fresh CSRF `state`; 400 when GOOGLE_CLIENT_ID is unset.
  app.get("/auth/google", async (_req, reply) => {
    try {
      const state = randomUUID();
      return reply.code(302).redirect(googleAuthUrl(state));
    } catch {
      return reply.code(400).send({ error: "sso not configured" });
    }
  });

  // #84 Google SSO — PUBLIC. The callback exchanges the `code` (live exchange in
  // prod), resolves/creates the member by email → session. 400 on a missing code
  // or any exchange/config failure.
  app.get("/auth/google/callback", async (req, reply) => {
    const { code } = req.query as { code?: string; state?: string };
    if (!code) return reply.code(400).send({ error: "missing code" });
    try {
      const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
      const { token, member } = await handleGoogleCallback(d.db, { code, userAgent: ua });
      return reply.code(200).send({
        token,
        member: { id: member.id, orgId: member.orgId, workspaceId: member.workspaceId, displayName: member.displayName, role: member.role },
      });
    } catch {
      return reply.code(400).send({ error: "sso callback failed" });
    }
  });
}
