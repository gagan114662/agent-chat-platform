import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin, verifyCredentials } from "../auth/auth.js";
import { roleOf } from "../rbac/rbac.js";

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

// registerAuth adds a root preHandler that resolves the bearer token into req.principal,
// plus the /auth/* routes. Must be registered BEFORE other route registrars so the
// preHandler covers them.
export function registerAuth(app: FastifyInstance, d: { db: DB }) {
  const PUBLIC_PATHS = new Set(["/auth/login", "/auth/members"]);
  app.addHook("preHandler", async (req, reply) => {
    const token = bearer(req);
    if (token) {
      const p = await resolveSession(d.db, token);
      if (p) req.principal = p;
    }
    if (process.env.AUTH_REQUIRE_SESSION && !req.principal) {
      // strip query string for the public-path check
      const path = req.url.split("?")[0];
      if (!PUBLIC_PATHS.has(path)) {
        return reply.code(401).send({ error: "unauthenticated" });
      }
    }
  });

  app.get("/auth/members", async (_req, reply) => {
    if (process.env.AUTH_REQUIRE_SESSION) return reply.code(404).send({ error: "not found" });
    return listMembersForLogin(d.db);
  });

  app.post("/auth/login", async (req, reply) => {
    const { memberId, password } = req.body as { memberId: string; password?: string };
    const strict = !!process.env.AUTH_REQUIRE_SESSION;
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
    const role = await roleOf(d.db, req.principal.userId);
    return { ...req.principal, role };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = bearer(req);
    if (token) await deleteSession(d.db, token);
    return reply.code(204).send();
  });
}
