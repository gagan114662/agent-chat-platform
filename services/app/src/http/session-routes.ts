import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { listSessions, revokeSession, revokeOtherSessions } from "../auth/auth.js";

// #84 device session management. All three routes operate ONLY over the caller's
// OWN sessions (org+user scoped from the authenticated principal): another user's
// session id never matches the WHERE, so a foreign id is not-found (404) and can
// never be revoked. The list returns NO bearer beyond the session id the holder
// already has; revoke-others keeps the caller's current token alive.
function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export function registerSessionRoutes(app: FastifyInstance, d: { db: DB }) {
  // List the caller's active sessions (no tokens/secrets).
  app.get("/auth/sessions", async (req) => {
    const { orgId, userId } = actor(req);
    return listSessions(d.db, { orgId, userId });
  });

  // Revoke ONE of the caller's own sessions. A session id that isn't the
  // caller's (another user/org, or unknown) deletes nothing → 404.
  app.delete("/auth/sessions/:id", async (req, reply) => {
    const { orgId, userId } = actor(req);
    const { id } = req.params as { id: string };
    const n = await revokeSession(d.db, { orgId, userId, sessionId: id });
    if (n === 0) return reply.code(404).send({ error: "session not found" });
    return reply.code(204).send();
  });

  // Revoke all of the caller's OTHER sessions, keeping the current bearer alive.
  app.post("/auth/sessions/revoke-others", async (req, reply) => {
    const { orgId, userId } = actor(req);
    // Keep the caller's current session token (the bearer) — best-effort: if the
    // caller authenticated via a non-bearer path (dev headers, no token), pass an
    // empty keep so all of the user's sessions are dropped.
    const keepToken = bearer(req) ?? "";
    await revokeOtherSessions(d.db, { orgId, userId, keepToken });
    return reply.code(204).send();
  });
}
