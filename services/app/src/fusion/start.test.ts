import { describe, it, expect } from "vitest";
import { startFusionRun, type StartFusionRunInput } from "./start.js";

// A fake temporal client that captures the workflow.start args so we can assert
// the RunFusionActivityInput the starter built.
function fakeTemporal() {
  const calls: Array<{ workflowId: string; input: any }> = [];
  const client = {
    workflow: {
      start: async (_wf: unknown, opts: { workflowId: string; args: any[] }) => {
        calls.push({ workflowId: opts.workflowId, input: opts.args[0] });
      },
    },
  } as any;
  return { client, calls };
}

const baseInput: StartFusionRunInput = {
  run: { id: "r-child", workflowId: "run-r-child" },
  orgId: "o1",
  threadId: "t1",
  repo: {
    githubOwner: "acme", githubName: "app", defaultBranch: "main",
    tokenEnvVar: "E2E_GITHUB_TOKEN", autonomy: "autopilot-merge",
  },
  agentId: "a1",
  intent: "fix bug",
  sandboxUrl: "http://runner:8090",
};

describe("startFusionRun", () => {
  it("uses the repo default branch as baseBranch when no override is given (flat)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, baseInput);
    expect(calls.length).toBe(1);
    expect(calls[0].input.baseBranch).toBe("main");
  });

  it("uses baseBranchOverride as the activity baseBranch when set (stacked)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, { ...baseInput, baseBranchOverride: "agent/r-parent" });
    expect(calls.length).toBe(1);
    expect(calls[0].input.baseBranch).toBe("agent/r-parent");
    // branch (the child's own branch) is still its own run id, unchanged.
    expect(calls[0].input.branch).toBe("agent/r-child");
  });

  it("threads model/provider into the activity input when set (#58)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, { ...baseInput, model: "claude-sonnet-4-6", provider: "bedrock" });
    expect(calls[0].input.model).toBe("claude-sonnet-4-6");
    expect(calls[0].input.provider).toBe("bedrock");
  });

  it("passes no model/provider when unset (default unchanged, #58)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, baseInput);
    expect(calls[0].input.model).toBeUndefined();
    expect(calls[0].input.provider).toBeUndefined();
  });

  it("threads mcpServers into the activity input when set (#57)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, { ...baseInput, mcpServers: ["filesystem"] });
    expect(calls[0].input.mcpServers).toEqual(["filesystem"]);
  });

  it("passes no mcpServers when unset (default unchanged, #57)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, baseInput);
    expect(calls[0].input.mcpServers).toBeUndefined();
  });

  it("threads repo.setupScript into the activity input when set (#71)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, {
      ...baseInput,
      repo: { ...baseInput.repo, setupScript: "pnpm install" },
    });
    expect(calls[0].input.setupScript).toBe("pnpm install");
  });

  it("passes no setupScript when the repo has none (default unchanged, #71)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, baseInput);
    expect(calls[0].input.setupScript).toBeUndefined();
  });

  it("threads repo.envVars into the activity input when set (#73)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, {
      ...baseInput,
      repo: { ...baseInput.repo, envVars: { NPM_TOKEN: "secret" } },
    });
    expect(calls[0].input.env).toEqual({ NPM_TOKEN: "secret" });
  });

  it("passes no env when the repo has no envVars (default unchanged, #73)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, { ...baseInput, repo: { ...baseInput.repo, envVars: {} } });
    expect(calls[0].input.env).toBeUndefined();
  });

  it("threads repo.githubApiUrl into the activity input when set (#73)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, {
      ...baseInput,
      repo: { ...baseInput.repo, githubApiUrl: "https://ghe.example.com/api/v3" },
    });
    expect(calls[0].input.githubApiUrl).toBe("https://ghe.example.com/api/v3");
  });

  it("passes no githubApiUrl when the repo has none (default unchanged, #73)", async () => {
    const { client, calls } = fakeTemporal();
    await startFusionRun(client, baseInput);
    expect(calls[0].input.githubApiUrl).toBeUndefined();
  });
});
