import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { createInvite, acceptInvite, listInvites, revokeInvite, seatCount, seatLimit } from "../auth/invites.js";
import { checkQuota } from "../billing/plans.js";
import { invites, members } from "../db/schema.js";

// #88 invite + member-directory routes. Create/list/revoke are admin-gated
// (`team:manage`) and org-scoped (a cross-org id is not-found → 404). POST
// /invites returns the plaintext token ONCE (never retrievable again — only the
// hash is stored). POST /invites/accept is PUBLIC (bypasses the session
// preHandler, like /auth/login) and is gated only by the invite token. GET
// /members is a secret-free, org-scoped member directory.
export function registerInviteRoutes(app: FastifyInstance, d: { db: DB }) {
  // Admin-gated invite creation + soft seat check.
  app.post("/invites", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    // #85 seat quota: gate on the org's plan seat limit. `ok` is false when the
    // org is already at/over its plan's seatLimit (unless unlimited, -1).
    const seatQuota = await checkQuota(d.db, orgId, "seats");
    if (!seatQuota.ok) {
      return reply.code(402).send({ error: `seat limit reached (quota reached: ${seatQuota.used}/${seatQuota.limit})` });
    }
    // Legacy soft seat check (env-configurable via ACP_SEAT_LIMIT) kept as a
    // secondary cap on top of the plan quota.
    if (await seatCount(d.db, orgId) >= seatLimit()) {
      return reply.code(402).send({ error: "seat limit reached" });
    }
    const { email, role, workspaceId } = req.body as { email?: string; role?: string; workspaceId?: string };
    if (!email?.trim()) return reply.code(400).send({ error: "email required" });

    // Default the workspace to the inviter's own when not specified.
    let ws = workspaceId;
    if (!ws) {
      const [me] = await d.db.select({ workspaceId: members.workspaceId }).from(members).where(and(eq(members.id, userId), eq(members.orgId, orgId)));
      ws = me?.workspaceId;
    }
    if (!ws) return reply.code(400).send({ error: "workspaceId required" });

    const { id, token } = await createInvite(d.db, { orgId, workspaceId: ws, email: email.trim(), role, byId: userId });
    // The plaintext `token` is returned ONCE here and never shown again.
    const [invite] = await d.db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        workspaceId: invites.workspaceId,
        status: invites.status,
        invitedById: invites.invitedById,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(eq(invites.id, id));
    return reply.code(201).send({ invite, token, note: "Share this invite link now — the token will not be shown again." });
  });

  // Admin-gated list of the org's pending invites (no token/hash).
  app.get("/invites", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return listInvites(d.db, orgId);
  });

  // Admin-gated revoke, org-scoped (cross-org/unknown id → 404).
  app.delete("/invites/:id", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    const [row] = await d.db.select({ id: invites.id }).from(invites).where(and(eq(invites.id, id), eq(invites.orgId, orgId)));
    if (!row) return reply.code(404).send({ error: "invite not found" });
    await revokeInvite(d.db, { orgId, id });
    return reply.code(204).send();
  });

  // PUBLIC: accept an invite by token (no session needed — bypassed in the auth
  // preHandler). Provisions a member; an invalid/revoked/already-accepted token
  // → 400. The response omits the member's passwordHash.
  app.post("/invites/accept", async (req, reply) => {
    const { token, displayName, password } = req.body as { token?: string; displayName?: string; password?: string };
    if (!token || !displayName?.trim()) return reply.code(400).send({ error: "token and displayName required" });
    try {
      const m = await acceptInvite(d.db, { token, displayName: displayName.trim(), password });
      return reply.code(201).send({
        member: { id: m.id, orgId: m.orgId, workspaceId: m.workspaceId, displayName: m.displayName, role: m.role },
      });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Org-scoped member directory — id/displayName/role/workspaceId, NO secrets.
  app.get("/members", async (req) => {
    const { orgId } = actor(req);
    return d.db
      .select({
        id: members.id,
        displayName: members.displayName,
        role: members.role,
        workspaceId: members.workspaceId,
      })
      .from(members)
      .where(eq(members.orgId, orgId))
      .orderBy(asc(members.id));
  });
}
