import { describe, it, expect, vi } from "vitest";
import { runFusion } from "./run-fusion.js";
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";
import type { ChecksStatus } from "../types.js";

function deps(checks: ChecksStatus[]) {
  const sandbox: SandboxRunner = {
    run: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "sha1" }),
  };
  let i = 0;
  const github: GitHubService = {
    openPr: vi.fn().mockResolvedValue({ number: 7, url: "u" }),
    getChecksStatus: vi.fn().mockImplementation(async () => checks[Math.min(i++, checks.length - 1)]),
    merge: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue([]),
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
});
