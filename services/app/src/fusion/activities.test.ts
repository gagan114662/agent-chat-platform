import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { buildAgentIntent, runChatFusionActivity, type RunFusionActivityInput } from "./activities.js";
import { createNode } from "../memory/memory.js";
import { orgs, runs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
});

describe("buildAgentIntent (#26 recall wiring)", () => {
  it("appends a recalled-context preamble when matching org memory exists; first line stays the task", async () => {
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "Auth uses scrypt" });

    const intent = "add realtime notify to the auth flow";
    const out = await buildAgentIntent(h.db, "o1", intent);

    expect(out.split("\n")[0]).toBe(intent); // first line unchanged → clean PR title
    expect(out).toContain("## Relevant prior context");
    expect(out).toContain("Use Postgres LISTEN/NOTIFY for realtime");
    expect(out).toContain("Auth uses scrypt");
  });

  it("returns the intent unchanged when there is no matching memory", async () => {
    const intent = "add realtime notify to the auth flow";
    expect(await buildAgentIntent(h.db, "o1", intent)).toBe(intent);
  });

  it("is org-scoped: another org's memory does not leak into the preamble", async () => {
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    const intent = "add realtime notify to the auth flow";
    // org o1 has no memory of its own → unchanged
    expect(await buildAgentIntent(h.db, "o1", intent)).toBe(intent);
  });
});

// A sentinel thrown from inside a fake to stop the activity once it has captured
// the value we want to assert (the activity runs no further work).
class Sentinel extends Error {}

function baseActivityInput(over: Partial<RunFusionActivityInput> = {}): RunFusionActivityInput {
  return {
    owner: "acme", repo: "app", baseBranch: "main",
    intent: "fix bug", branch: "agent/r1",
    tokenEnvVar: "E2E_GITHUB_TOKEN_TEST", sandboxUrl: "http://runner:8090",
    pollMs: 1, maxPolls: 1, autonomy: "monitor-only",
    sink: { orgId: "o1", threadId: "t1", runId: "r1", agentId: "a1" },
    ...over,
  };
}

describe("runChatFusionActivity (#73 env + GHE threading)", () => {
  beforeEach(() => { process.env.E2E_GITHUB_TOKEN_TEST = "ghtoken"; });

  it("builds the GitHub client with the repo's githubApiUrl (GHE base URL)", async () => {
    let gotBaseUrl: string | undefined;
    let gotToken: string | undefined;
    await expect(
      runChatFusionActivity(baseActivityInput({ githubApiUrl: "https://ghe.example.com/api/v3" }), {
        githubFactory: (token, baseUrl) => {
          gotToken = token;
          gotBaseUrl = baseUrl;
          throw new Sentinel("stop after github construction");
        },
      }),
    ).rejects.toBeInstanceOf(Sentinel);
    expect(gotToken).toBe("ghtoken");
    expect(gotBaseUrl).toBe("https://ghe.example.com/api/v3");
  });

  it("passes undefined baseUrl when the repo has no githubApiUrl (github.com)", async () => {
    let gotBaseUrl: string | undefined = "unset";
    await expect(
      runChatFusionActivity(baseActivityInput(), {
        githubFactory: (_token, baseUrl) => {
          gotBaseUrl = baseUrl;
          throw new Sentinel("stop");
        },
      }),
    ).rejects.toBeInstanceOf(Sentinel);
    expect(gotBaseUrl).toBeUndefined();
  });

  it("passes the repo's envVars through to the sandbox run request", async () => {
    // The sink writes a runEvent on sandbox_started and transitions the run, so a
    // pending run row must exist for the org/run id.
    await h.db.insert(runs).values({ id: "r1", orgId: "o1", taskId: "task-r1", state: "pending", workflowId: "wf-r1" });

    let gotEnv: Record<string, string> | undefined;
    const fakeSandbox: any = {
      run: async (req: any) => { gotEnv = req.env; throw new Sentinel("stop after sandbox.run"); },
      feedback: async () => { throw new Sentinel("unused"); },
      plan: async () => { throw new Sentinel("unused"); },
    };
    const fakeGithub: any = { openPr: async () => { throw new Sentinel("unused"); } };

    await expect(
      runChatFusionActivity(baseActivityInput({ env: { NPM_TOKEN: "secret" } }), {
        githubFactory: () => fakeGithub,
        sandboxFactory: () => fakeSandbox,
      }),
    ).rejects.toBeInstanceOf(Sentinel);
    expect(gotEnv).toEqual({ NPM_TOKEN: "secret" });
  });
});
