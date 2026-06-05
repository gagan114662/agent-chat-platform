import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, channels, threads, agents, tasks, runs } from "../db/schema.js";
import { latestSkill, saveSkillVersion } from "../agents/skills.js";
import { gatherRollouts, heuristicProposer, heuristicEvaluator, optimizeAgentSkill } from "./runner.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

// Seed an org/agent and N runs for the agent's tasks with the given states.
async function seed(states: string[]) {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
  await h.db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" });
  await h.db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "T1" });
  await h.db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} });
  for (let i = 0; i < states.length; i++) {
    await h.db.insert(tasks).values({ id: `tk${i}`, orgId: "o1", threadId: "t1", title: `task ${i}`, state: "open", assigneeKind: "agent", assigneeId: "a1", createdByKind: "agent", createdById: "planner" });
    await h.db.insert(runs).values({ id: `r${i}`, orgId: "o1", taskId: `tk${i}`, state: states[i], workflowId: `wf${i}` });
  }
}

beforeEach(async () => { await seed(["merged", "checks_failed", "checks_failed"]); });

describe("gatherRollouts", () => {
  it("scores the agent's runs (merged=1, failure=0)", async () => {
    const r = await gatherRollouts(h.db, "o1", "a1");
    expect(r).toHaveLength(3);
    expect(r.filter((x) => x.score === 1)).toHaveLength(1);
    expect(r.filter((x) => x.score === 0)).toHaveLength(2);
    expect(r.some((x) => x.transcript?.includes("checks_failed"))).toBe(true);
  });
});

describe("heuristic proposer + evaluator", () => {
  it("proposes a failure-relevant lesson the evaluator rewards", () => {
    const rollouts = [{ score: 0, transcript: "x → checks_failed" }];
    const edit = heuristicProposer("base", rollouts);
    expect(edit.op).toBe("append");
    expect((edit as { text: string }).text).toMatch(/checks pass/);
    // adding the lesson strictly improves the held-out score
    const before = heuristicEvaluator("base");
    const after = heuristicEvaluator("base" + (edit as { text: string }).text);
    expect(after).toBeGreaterThan(before);
  });
});

describe("optimizeAgentSkill (live)", () => {
  it("learns a lesson from failing runs and saves a new skill version", async () => {
    expect(await latestSkill(h.db, "o1", "a1")).toBeNull();
    const out = await optimizeAgentSkill(h.db, "o1", "a1");
    expect(out.accepted).toBe(true);
    expect(out.afterScore!).toBeGreaterThan(out.beforeScore);
    const saved = await latestSkill(h.db, "o1", "a1");
    expect(saved?.content).toMatch(/checks pass/);
    expect(saved?.version).toBe(1);
  });

  it("rejects (no new version) once the lesson is already present", async () => {
    // pre-seed the skill with every lesson → nothing left to improve
    const full = "- Run the test suite locally and make checks pass before opening the PR.\n"
      + "- Break a large task into focused steps, but still finish the whole task — don't ship a partial change.\n"
      + "- Read the error output and fix the root cause before re-running; don't retry blindly.\n"
      + "- Achieve the task's actual outcome. If something is impossible from the sandbox (a real account, credential, deploy target, or payment), STOP and say exactly what is blocked — do NOT make a token change and report done.";
    await saveSkillVersion(h.db, "o1", "a1", full);
    const out = await optimizeAgentSkill(h.db, "o1", "a1");
    expect(out.accepted).toBe(false);
    expect((await latestSkill(h.db, "o1", "a1"))?.version).toBe(1); // unchanged
  });
});
