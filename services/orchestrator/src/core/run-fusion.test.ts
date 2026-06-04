import { describe, it, expect, vi } from "vitest";
import { runFusion } from "./run-fusion.js";
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";
import type { ChecksStatus } from "../types.js";

function deps(checks: ChecksStatus[]) {
  const sandbox: SandboxRunner = {
    run: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "sha1" }),
    feedback: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "fixsha" }),
    plan: vi.fn().mockResolvedValue({ plan: "PLAN" }),
  };
  let i = 0;
  const github: GitHubService = {
    openPr: vi.fn().mockResolvedValue({ number: 7, url: "u" }),
    getChecksStatus: vi.fn().mockImplementation(async () => checks[Math.min(i++, checks.length - 1)]),
    merge: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getCheckFailureContext: vi.fn().mockResolvedValue("ci: lint failed"),
    listReviewComments: vi.fn().mockResolvedValue([]),
    updatePr: vi.fn().mockResolvedValue(undefined),
  };
  return { sandbox, github };
}

const input = {
  owner: "o", repo: "r", repoUrl: "https://github.com/o/r.git",
  baseBranch: "main", intent: "do it", branch: "feature/x",
};

describe("runFusion", () => {
  it("auto-merges when checks go green", async () => {
    const d = deps(["pending", "success"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    expect(out.outcome).toBe("merged");
    expect(d.github.merge).toHaveBeenCalledWith("o", "r", 7);
  });

  it("does not merge and reports failure when checks fail", async () => {
    const d = deps(["failure"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    expect(out.outcome).toBe("checks_failed");
    expect(d.github.merge).not.toHaveBeenCalled();
  });

  it("times out if checks never resolve", async () => {
    const d = deps(["pending"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 3 });
    expect(out.outcome).toBe("timeout");
    expect(d.github.merge).not.toHaveBeenCalled();
  });

  it("emits ordered step events when onEvent is provided", async () => {
    const d = deps(["pending", "success"]);
    const events: string[] = [];
    await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      onEvent: (e) => { events.push(e.type); },
    });
    expect(events).toEqual([
      "sandbox_started", "branch_pushed", "pr_opened", "checks", "checks", "outcome",
    ]);
  });

  it("holds for human when the merge gate declines, instead of merging", async () => {
    const d = deps(["success"]);
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      mergeGate: async () => ({ merge: false, reason: "risk tripwire" }),
    });
    expect(out.outcome).toBe("held_for_human");
    expect(d.github.merge).not.toHaveBeenCalled();
  });

  it("merges when the gate approves", async () => {
    const d = deps(["success"]);
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      mergeGate: async () => ({ merge: true, reason: "autopilot" }),
    });
    expect(out.outcome).toBe("merged");
    expect(d.github.merge).toHaveBeenCalled();
  });

  it("fixes on red then merges (failure -> ciFix -> success)", async () => {
    const d = deps(["failure", "success"]);
    const ciFix = vi.fn().mockResolvedValue({ commitSha: "fixsha" });
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      maxFixAttempts: 1,
      ciFix,
    });
    expect(out.outcome).toBe("merged");
    expect(ciFix).toHaveBeenCalledTimes(1);
    expect(ciFix).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "feature/x", failure: "ci: lint failed", prNumber: 7 }),
    );
    expect(d.github.getCheckFailureContext).toHaveBeenCalled();
    // merged on the new (fixed) commit
    expect(out.commitSha).toBe("fixsha");
    expect(d.github.merge).toHaveBeenCalledWith("o", "r", 7);
  });

  it("does not attempt a fix when maxFixAttempts defaults to 0", async () => {
    const d = deps(["failure"]);
    const ciFix = vi.fn().mockResolvedValue({ commitSha: "fixsha" });
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 5, ciFix });
    expect(out.outcome).toBe("checks_failed");
    expect(ciFix).not.toHaveBeenCalled();
    expect(d.github.merge).not.toHaveBeenCalled();
  });

  it("escalates after exhausting maxFixAttempts (still red)", async () => {
    const d = deps(["failure"]); // always red
    const ciFix = vi.fn().mockResolvedValue({ commitSha: "fixsha" });
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      maxFixAttempts: 2,
      ciFix,
    });
    expect(out.outcome).toBe("checks_failed");
    expect(ciFix).toHaveBeenCalledTimes(2);
  });

  it("parks at awaiting_plan when planMode + gate declines (no edit run)", async () => {
    const d = deps(["success"]);
    const events: string[] = [];
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      planMode: true,
      planGate: async () => ({ approved: false }),
      onEvent: (e) => { events.push(e.type); },
    });
    expect(out.outcome).toBe("awaiting_plan");
    expect(d.sandbox.plan).toHaveBeenCalledTimes(1);
    expect(d.sandbox.run).not.toHaveBeenCalled();
    expect(d.github.openPr).not.toHaveBeenCalled();
    expect(events).toEqual(["plan_proposed", "outcome"]);
  });

  it("PR title is the clean first line of the intent (multi-line intent → single-line title)", async () => {
    const d = deps(["success"]);
    const multiLine = {
      ...input,
      intent: "add realtime notify to the auth flow\n\n## Relevant prior context\n- (decision) Use Postgres LISTEN/NOTIFY",
    };
    await runFusion(d, multiLine, { pollMs: 0, maxPolls: 5 });
    expect(d.github.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ title: "agent: add realtime notify to the auth flow" }),
    );
    // body keeps the full (multi-line) intent
    expect(d.github.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("## Relevant prior context") }),
    );
  });

  it("PR title for a single-line intent is unchanged", async () => {
    const d = deps(["success"]);
    await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    expect(d.github.openPr).toHaveBeenCalledWith(
      expect.objectContaining({ title: "agent: do it" }),
    );
  });

  it("threads model/provider from the input into the sandbox run (#58)", async () => {
    const d = deps(["success"]);
    await runFusion(d, { ...input, model: "claude-sonnet-4-6", provider: "bedrock" }, { pollMs: 0, maxPolls: 5 });
    expect(d.sandbox.run).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6", provider: "bedrock" }),
    );
  });

  it("threads model into the plan run when planMode is set (#58)", async () => {
    const d = deps(["success"]);
    await runFusion(d, { ...input, model: "claude-sonnet-4-6" }, {
      pollMs: 0, maxPolls: 5,
      planMode: true,
      planGate: async () => ({ approved: true }),
    });
    expect(d.sandbox.plan).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-sonnet-4-6" }),
    );
  });

  it("passes no model/provider when the input omits them (default unchanged, #58)", async () => {
    const d = deps(["success"]);
    await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    const call = (d.sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBeUndefined();
    expect(call.provider).toBeUndefined();
  });

  it("proceeds to merge when planMode + gate approves", async () => {
    const d = deps(["success"]);
    const out = await runFusion(d, input, {
      pollMs: 0, maxPolls: 5,
      planMode: true,
      planGate: async () => ({ approved: true }),
    });
    expect(out.outcome).toBe("merged");
    expect(d.sandbox.plan).toHaveBeenCalledTimes(1);
    expect(d.sandbox.run).toHaveBeenCalledTimes(1);
    expect(d.github.merge).toHaveBeenCalled();
  });
});
