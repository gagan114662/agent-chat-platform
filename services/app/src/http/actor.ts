import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    principal?: { orgId: string; userId: string };
  }
}

// Returns the authenticated principal (set by the auth preHandler from a session token),
// or the dev-header stub fallback (x-org-id/x-user-id) for incremental migration / tests.
export function actor(req: Pick<FastifyRequest, "headers" | "principal">) {
  if (req.principal) return req.principal;
  return {
    orgId: (req.headers["x-org-id"] as string) ?? "o1",
    userId: (req.headers["x-user-id"] as string) ?? "m1",
  };
}
