import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { actor } from "./actor.js";
import { roleOf, can } from "../rbac/rbac.js";
import { createTeam, addTeamMember, removeTeamMember, listTeams, type MemberKind } from "../teams/teams.js";
import { teams } from "../db/schema.js";

// #79 team CRUD routes. Mutations are admin-gated (`team:manage`); reads are
// org-scoped. A team that isn't in the actor's org is treated as not-found (404)
// — no cross-org reads or writes.
export function registerTeamRoutes(app: FastifyInstance, d: { db: DB }) {
  app.get("/teams", async (req) => listTeams(d.db, actor(req).orgId));

  app.post("/teams", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    const team = await createTeam(d.db, { orgId, name: name.trim() });
    return reply.code(201).send(team);
  });

  app.post("/teams/:id/members", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id } = req.params as { id: string };
    const { memberKind, memberId } = req.body as { memberKind?: MemberKind; memberId?: string };
    const [team] = await d.db.select().from(teams).where(and(eq(teams.id, id), eq(teams.orgId, orgId)));
    if (!team) return reply.code(404).send({ error: "team not found" });
    if (memberKind !== "human" && memberKind !== "agent") return reply.code(400).send({ error: "memberKind must be human|agent" });
    if (!memberId?.trim()) return reply.code(400).send({ error: "memberId required" });
    try {
      await addTeamMember(d.db, { orgId, teamId: id, memberKind, memberId: memberId.trim() });
      return reply.code(201).send({ ok: true });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.delete("/teams/:id/members/:kind/:mid", async (req, reply) => {
    const { orgId, userId } = actor(req);
    if (!can(await roleOf(d.db, userId, orgId), "team:manage")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const { id, kind, mid } = req.params as { id: string; kind: string; mid: string };
    const [team] = await d.db.select().from(teams).where(and(eq(teams.id, id), eq(teams.orgId, orgId)));
    if (!team) return reply.code(404).send({ error: "team not found" });
    if (kind !== "human" && kind !== "agent") return reply.code(400).send({ error: "kind must be human|agent" });
    await removeTeamMember(d.db, { orgId, teamId: id, memberKind: kind, memberId: mid });
    return reply.code(204).send();
  });
}
