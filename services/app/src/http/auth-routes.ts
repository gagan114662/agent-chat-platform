import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DB } from "../db/client.js";
import { createSession, resolveSession, deleteSession, listMembersForLogin } from "../auth/auth.js";

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers["authorization"];
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

// registerAuth adds a root preHandler that resolves the bearer token into req.principal,
// plus the /auth/* routes. Must be registered BEFORE other route registrars so the
// preHandler covers them.
export function registerAuth(app: FastifyInstance, d: { db: DB }) {
  app.addHook("preHandler", async (req) => {
    const token = bearer(req);
    if (token) {
      const p = await resolveSession(d.db, token);
      if (p) req.principal = p;
    }
  });

  app.get("/auth/members", async () => listMembersForLogin(d.db));

  app.post("/auth/login", async (req, reply) => {
    const { memberId } = req.body as { memberId: string };
    try {
      const { token, member } = await createSession(d.db, memberId);
      return reply.code(201).send({ token, member });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "unauthenticated" });
    return req.principal;
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = bearer(req);
    if (token) await deleteSession(d.db, token);
    return reply.code(204).send();
  });
}
