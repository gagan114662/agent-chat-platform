import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import type { Client } from "@temporalio/client";
import { testDb, closeDb } from "../db/test-harness.js";
import { handleMentions, postAgentMessage, MAX_DEPTH } from "./handle-mentions.js";
import { listMessages } from "./messages.js";
import { orgs, workspaces, channels, threads, repos, agents, teams, teamMembers } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Fake temporal: records each workflow.start so we can assert depth threading
// without a real cluster. Throwing instead would also work, but recording lets
// us assert mentionDepth made it into the run input.
function fakeTemporal() {
  const starts: any[] = [];
  const temporal = { workflow: { start: vi.fn(async (_wf: unknown, opts: any) => { starts.push(opts); }) } } as unknown as Client;
  return { temporal, starts };
}

function deps(temporal: Client) {
  return { db: h.db, sql: h.sql, temporal, sandboxUrl: "http://runner:8090" };
}

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(repos).values({
    id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "o", githubName: "r",
    defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN",
  });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T", repoId: "r1" });
  await h.db.insert(agents).values({ id: "self", orgId: "o1", workspaceId: "w1", handle: "self", displayName: "Self" });
  await h.db.insert(agents).values({ id: "bob", orgId: "o1", workspaceId: "w1", handle: "bob", displayName: "Bob" });
  process.env.E2E_GITHUB_TOKEN = "tok";
});

afterAll(() => { delete process.env.E2E_GITHUB_TOKEN; });

describe("handleMentions (#27 shared, loop-guarded handler)", () => {
  it("an agent-authored message @mentioning another agent starts that agent's run (depth + 1)", async () => {
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@bob please review", authorKind: "agent", authorId: "self", depth: 0,
    });
    expect(started.length).toBe(1);
    expect(starts.length).toBe(1);
    // child runs one level deeper than the author
    expect(starts[0].args[0].sink.mentionDepth).toBe(1);
    expect(starts[0].args[0].sink.agentId).toBe("bob");
  });

  it("does NOT self-trigger: an agent @mentioning itself starts no run", async () => {
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@self note to self", authorKind: "agent", authorId: "self", depth: 0,
    });
    expect(started).toEqual([]);
    expect(starts.length).toBe(0);
  });

  it("loop guard: at MAX_DEPTH no further runs are spawned", async () => {
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@bob keep going", authorKind: "agent", authorId: "self", depth: MAX_DEPTH,
    });
    expect(started).toEqual([]);
    expect(starts.length).toBe(0);
  });

  it("human depth-0 mention still starts the run (parity with the route)", async () => {
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@bob please fix", authorKind: "human", authorId: "u1", depth: 0,
    });
    expect(started.length).toBe(1);
    expect(starts[0].args[0].sink.mentionDepth).toBe(1);
  });

  it("postAgentMessage writes an agent message + triggers a guarded mention run", async () => {
    const { temporal, starts } = fakeTemporal();
    const { message, startedRuns } = await postAgentMessage(deps(temporal), {
      orgId: "o1", threadId: "t1", agentId: "self", body: "@bob can you take this?", depth: 0,
    });
    expect(message.authorKind).toBe("agent");
    expect(message.authorId).toBe("self");
    expect(startedRuns.length).toBe(1);
    expect(starts.length).toBe(1);
    // the message is persisted in the thread
    const msgs = await listMessages(h.db, "t1", "o1");
    expect(msgs.map((m) => m.body)).toContain("@bob can you take this?");
  });

  it("@team fans a run out to each of the team's agent members (#79)", async () => {
    // team with 2 agents (bob + a third agent on the same repo's workspace)
    await h.db.insert(agents).values({ id: "carol", orgId: "o1", workspaceId: "w1", handle: "carol", displayName: "Carol" });
    await h.db.insert(teams).values({ id: "tm", orgId: "o1", name: "backend-team" });
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "agent", memberId: "bob" });
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "agent", memberId: "carol" });
    // a human member of the team should NOT trigger a run
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "human", memberId: "u1" });

    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@backend-team please ship", authorKind: "human", authorId: "u1", depth: 0,
    });
    expect(started.length).toBe(2);
    expect(starts.length).toBe(2);
    expect(starts.map((s) => s.args[0].sink.agentId).sort()).toEqual(["bob", "carol"]);
    // children one level deeper than the human author
    for (const s of starts) expect(s.args[0].sink.mentionDepth).toBe(1);
  });

  it("@team with 0 agent members starts 0 runs (#79)", async () => {
    await h.db.insert(teams).values({ id: "empty", orgId: "o1", name: "empty-team" });
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@empty-team anyone?", authorKind: "human", authorId: "u1", depth: 0,
    });
    expect(started).toEqual([]);
    expect(starts.length).toBe(0);
  });

  it("@team is org-scoped: another org's team of the same name fans out nothing (#79)", async () => {
    await h.db.insert(orgs).values({ id: "o2", name: "O2" });
    await h.db.insert(workspaces).values({ id: "w2", orgId: "o2", name: "W2" });
    await h.db.insert(agents).values({ id: "x", orgId: "o2", workspaceId: "w2", handle: "x", displayName: "X" });
    await h.db.insert(teams).values({ id: "tm2", orgId: "o2", name: "backend-team" });
    await h.db.insert(teamMembers).values({ orgId: "o2", teamId: "tm2", memberKind: "agent", memberId: "x" });
    const { temporal, starts } = fakeTemporal();
    // o1 mentions a name that only exists as a team in o2 → nothing
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@backend-team go", authorKind: "human", authorId: "u1", depth: 0,
    });
    expect(started).toEqual([]);
    expect(starts.length).toBe(0);
  });

  it("@team respects the loop guard: at MAX_DEPTH no team runs spawn (#79)", async () => {
    await h.db.insert(teams).values({ id: "tm", orgId: "o1", name: "backend-team" });
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "agent", memberId: "bob" });
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@backend-team keep going", authorKind: "agent", authorId: "self", depth: MAX_DEPTH,
    });
    expect(started).toEqual([]);
    expect(starts.length).toBe(0);
  });

  it("@team does not self-trigger the authoring agent but runs its teammates (#79)", async () => {
    await h.db.insert(teams).values({ id: "tm", orgId: "o1", name: "backend-team" });
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "agent", memberId: "self" });
    await h.db.insert(teamMembers).values({ orgId: "o1", teamId: "tm", memberKind: "agent", memberId: "bob" });
    const { temporal, starts } = fakeTemporal();
    const started = await handleMentions(deps(temporal), {
      orgId: "o1", threadId: "t1", body: "@backend-team review", authorKind: "agent", authorId: "self", depth: 0,
    });
    // self is skipped; only bob runs (depth + 1)
    expect(started.length).toBe(1);
    expect(starts.map((s) => s.args[0].sink.agentId)).toEqual(["bob"]);
    expect(starts[0].args[0].sink.mentionDepth).toBe(1);
  });

  it("postAgentMessage at MAX_DEPTH still posts the message but spawns no run (loop guard)", async () => {
    const { temporal, starts } = fakeTemporal();
    const { message, startedRuns } = await postAgentMessage(deps(temporal), {
      orgId: "o1", threadId: "t1", agentId: "self", body: "@bob loop?", depth: MAX_DEPTH,
    });
    expect(message.authorKind).toBe("agent");
    expect(startedRuns).toEqual([]);
    expect(starts.length).toBe(0);
  });
});
