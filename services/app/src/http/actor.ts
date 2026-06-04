import type { FastifyRequest } from "fastify";
import { devHeadersAllowed } from "../auth/dev-mode.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: { orgId: string; userId: string };
  }
}

// Returns the authenticated principal (set by the auth preHandler from a session token).
// Falls back to the dev-header stub (x-org-id/x-user-id) ONLY when dev headers are allowed
// (ACP_ALLOW_DEV_HEADERS=1); otherwise it throws (fail-closed — the auth preHandler should
// already have 401'd before we get here).
export function actor(req: Pick<FastifyRequest, "headers" | "principal">) {
  if (req.principal) return req.principal;
  if (devHeadersAllowed()) {
    return {
      orgId: (req.headers["x-org-id"] as string) ?? "o1",
      userId: (req.headers["x-user-id"] as string) ?? "m1",
    };
  }
  throw new Error("unauthenticated");
}
