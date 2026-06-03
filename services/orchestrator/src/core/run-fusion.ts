import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";

export interface FusionDeps {
  sandbox: SandboxRunner;
  github: GitHubService;
}

export interface FusionInput {
  owner: string;
  repo: string;
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
}

export interface FusionOptions {
  pollMs: number;
  maxPolls: number;
}

export type FusionOutcome = "merged" | "checks_failed" | "timeout";

export interface FusionResult {
  outcome: FusionOutcome;
  prNumber?: number;
  prUrl?: string;
  commitSha?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// NOTE: In Plan 4 the CI-resolution loop (fix-on-red) and risk router replace
// the simple failure/return below. The skeleton just gates on green/red/timeout.
export async function runFusion(
  deps: FusionDeps,
  input: FusionInput,
  opts: FusionOptions,
): Promise<FusionResult> {
  const run = await deps.sandbox.run({
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    intent: input.intent,
    branch: input.branch,
  });

  const pr = await deps.github.openPr({
    owner: input.owner,
    repo: input.repo,
    head: run.branch,
    base: input.baseBranch,
    title: `agent: ${input.intent}`,
    body: `Automated change for intent: ${input.intent}\n\nCommit: ${run.commitSha}`,
  });

  for (let i = 0; i < opts.maxPolls; i++) {
    const status = await deps.github.getChecksStatus(input.owner, input.repo, run.commitSha);
    if (status === "success") {
      await deps.github.merge(input.owner, input.repo, pr.number);
      return { outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (status === "failure") {
      return { outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (i < opts.maxPolls - 1) await sleep(opts.pollMs);
  }
  return { outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
}
