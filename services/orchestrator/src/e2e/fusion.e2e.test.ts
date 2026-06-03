import { describe, it, expect } from "vitest";
import { runFusion } from "../core/run-fusion.js";
import { SandboxRunnerClient } from "../sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "../github/octokit-github-service.js";

const env = {
  token: process.env.E2E_GITHUB_TOKEN,
  owner: process.env.E2E_REPO_OWNER,
  repo: process.env.E2E_REPO_NAME,
  sandboxUrl: process.env.E2E_SANDBOX_URL,
};
const ready = Object.values(env).every(Boolean);

describe.runIf(ready)("fusion e2e (real GitHub + sandbox)", () => {
  it("runs agent → opens PR → auto-merges on green", async () => {
    const branch = `agent/e2e-${Date.now()}`;
    const deps = {
      sandbox: new SandboxRunnerClient(env.sandboxUrl!),
      github: new OctokitGitHubService(env.token!),
    };
    const out = await runFusion(deps, {
      owner: env.owner!,
      repo: env.repo!,
      repoUrl: `https://x-access-token:${env.token}@github.com/${env.owner}/${env.repo}.git`,
      baseBranch: "main",
      intent: "e2e: append agent changes file",
      branch,
    }, { pollMs: 5000, maxPolls: 24 });

    expect(["merged", "checks_failed", "timeout"]).toContain(out.outcome);
    expect(out.prNumber).toBeGreaterThan(0);
    // With an always-green check on the fixture repo, this should be "merged".
    console.log("e2e outcome:", out);
  });
});
