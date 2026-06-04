import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { teams, teamMembers, agents, members } from "../db/schema.js";

// #79 teams: a named group of members/agents in an org. `@team` mentions fan a
// run out to the team's agent members (see chat/handle-mentions). All operations
// are org-scoped; a team or member from another org is never visible/usable.

export type MemberKind = "human" | "agent";

export async function createTeam(db: DB, t: { orgId: string; name: string }) {
  const [team] = await db.insert(teams).values({
    id: randomUUID(), orgId: t.orgId, name: t.name,
  }).returning();
  return team;
}

export function listTeams(db: DB, orgId: string) {
  return db.select().from(teams).where(eq(teams.orgId, orgId)).orderBy(asc(teams.name));
}

// addTeamMember verifies the team and the referenced member/agent both exist in
// the org before linking them. Idempotent: re-adding the same (kind,id) is a
// no-op via the composite PK. Throws if the team or member/agent isn't in the org.
export async function addTeamMember(
  db: DB,
  m: { orgId: string; teamId: string; memberKind: MemberKind; memberId: string },
) {
  const [team] = await db.select().from(teams).where(and(eq(teams.id, m.teamId), eq(teams.orgId, m.orgId)));
  if (!team) throw new Error(`team not found in org: ${m.teamId}`);

  if (m.memberKind === "agent") {
    const [a] = await db.select().from(agents).where(and(eq(agents.id, m.memberId), eq(agents.orgId, m.orgId)));
    if (!a) throw new Error(`agent not found in org: ${m.memberId}`);
  } else {
    const [u] = await db.select().from(members).where(and(eq(members.id, m.memberId), eq(members.orgId, m.orgId)));
    if (!u) throw new Error(`member not found in org: ${m.memberId}`);
  }

  await db.insert(teamMembers).values({
    orgId: m.orgId, teamId: m.teamId, memberKind: m.memberKind, memberId: m.memberId,
  }).onConflictDoNothing();
}

export async function removeTeamMember(
  db: DB,
  m: { orgId: string; teamId: string; memberKind: MemberKind; memberId: string },
) {
  await db.delete(teamMembers).where(and(
    eq(teamMembers.orgId, m.orgId),
    eq(teamMembers.teamId, m.teamId),
    eq(teamMembers.memberKind, m.memberKind),
    eq(teamMembers.memberId, m.memberId),
  ));
}

// teamAgentIds resolves a team BY NAME to its agent members' ids (org-scoped).
// Used by `@team` mention resolution. Returns [] for an unknown team, a team
// with no agent members, or a cross-org lookup.
export async function teamAgentIds(db: DB, orgId: string, teamName: string): Promise<string[]> {
  const [team] = await db.select().from(teams).where(and(eq(teams.orgId, orgId), eq(teams.name, teamName)));
  if (!team) return [];
  const rows = await db.select({ memberId: teamMembers.memberId }).from(teamMembers).where(and(
    eq(teamMembers.orgId, orgId),
    eq(teamMembers.teamId, team.id),
    eq(teamMembers.memberKind, "agent"),
  ));
  return rows.map((r) => r.memberId);
}
