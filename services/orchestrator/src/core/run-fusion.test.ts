import { describe, it, expect, vi } from "vitest";
import { runFusion } from "./run-fusion.js";
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";
import type { ChecksStatus } from "../types.js";

function deps(checks: ChecksStatus[]) {
  const sandbox: SandboxRunner = {
    run: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "sha1" }),
    feedback: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "fixsha" }),
  };
  let i = 0;
  const github: GitHubService = {
    openPr: vi.fn().mockResolvedValue({ number: 7, url: "u" }),
    getChecksStatus: vi.fn().mockImplementation(async () => checks[Math.min(i++, checks.length - 1)]),
    merge: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getCheckFailureContext: vi.fn().mockResolvedValue("ci: lint failed"),
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
});
