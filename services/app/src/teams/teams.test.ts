import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { createTeam, addTeamMember, removeTeamMember, listTeams, teamAgentIds } from "./teams.js";
import { orgs, workspaces, members, agents } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
  await h.db.insert(members).values({ id: "u1", orgId: "o1", workspaceId: "w1", displayName: "You" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "ann", displayName: "Ann" });
  await h.db.insert(agents).values({ id: "a2", orgId: "o1", workspaceId: "w1", handle: "bob", displayName: "Bob" });
  // a foreign-org agent + member to prove org-scoping
  await h.db.insert(agents).values({ id: "ax", orgId: "o2", workspaceId: "w2", handle: "ann", displayName: "AnnX" });
  await h.db.insert(members).values({ id: "ux", orgId: "o2", workspaceId: "w2", displayName: "Them" });
});

describe("teams (#79)", () => {
  it("createTeam + add an agent + a human → listTeams and teamAgentIds reflect it", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "backend-team" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a2" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "human", memberId: "u1" });

    const teams = await listTeams(h.db, "o1");
    expect(teams.map((t) => t.name)).toContain("backend-team");

    // teamAgentIds returns only the agent members, by team name
    const agentIds = await teamAgentIds(h.db, "o1", "backend-team");
    expect(agentIds.sort()).toEqual(["a1", "a2"]);
  });

  it("addTeamMember rejects an agent that isn't in the org", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "t" });
    // foreign-org agent id
    await expect(addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "ax" }))
      .rejects.toThrow();
    // nonexistent
    await expect(addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "nope" }))
      .rejects.toThrow();
  });

  it("addTeamMember rejects a human that isn't in the org", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "t" });
    await expect(addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "human", memberId: "ux" }))
      .rejects.toThrow();
  });

  it("removeTeamMember drops the row", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "t" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    await removeTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    expect(await teamAgentIds(h.db, "o1", "t")).toEqual([]);
  });

  it("is org-scoped: listTeams + teamAgentIds never cross orgs", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "backend-team" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    // org2 sees no teams and resolves no agents for the same name
    expect(await listTeams(h.db, "o2")).toEqual([]);
    expect(await teamAgentIds(h.db, "o2", "backend-team")).toEqual([]);
  });

  it("addTeamMember is idempotent (composite PK) and teamAgentIds dedups", async () => {
    const team = await createTeam(h.db, { orgId: "o1", name: "t" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    await addTeamMember(h.db, { orgId: "o1", teamId: team.id, memberKind: "agent", memberId: "a1" });
    expect(await teamAgentIds(h.db, "o1", "t")).toEqual(["a1"]);
  });
});
