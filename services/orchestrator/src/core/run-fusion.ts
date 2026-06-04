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

export type FusionOutcome = "merged" | "checks_failed" | "timeout" | "held_for_human";

export type FusionEvent =
  | { type: "sandbox_started" }
  | { type: "branch_pushed"; branch: string; commitSha: string }
  | { type: "pr_opened"; prNumber: number; prUrl: string }
  | { type: "checks"; status: "pending" | "success" | "failure" }
  | { type: "outcome"; outcome: FusionOutcome; prNumber?: number; prUrl?: string; commitSha?: string };

export interface FusionOptions {
  pollMs: number;
  maxPolls: number;
  onEvent?: (e: FusionEvent) => void | Promise<void>;
  mergeGate?: (info: { prNumber: number; prUrl: string; commitSha: string; branch: string }) => Promise<{ merge: boolean; reason: string }>;
}

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
  const emit = async (e: FusionEvent) => { if (opts.onEvent) await opts.onEvent(e); };

  await emit({ type: "sandbox_started" });
  const run = await deps.sandbox.run({
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    intent: input.intent,
    branch: input.branch,
  });
  await emit({ type: "branch_pushed", branch: run.branch, commitSha: run.commitSha });

  const pr = await deps.github.openPr({
    owner: input.owner,
    repo: input.repo,
    head: run.branch,
    base: input.baseBranch,
    title: `agent: ${input.intent}`,
    body: `Automated change for intent: ${input.intent}\n\nCommit: ${run.commitSha}`,
  });
  await emit({ type: "pr_opened", prNumber: pr.number, prUrl: pr.url });

  for (let i = 0; i < opts.maxPolls; i++) {
    const status = await deps.github.getChecksStatus(input.owner, input.repo, run.commitSha);
    await emit({ type: "checks", status });
    if (status === "success") {
      if (opts.mergeGate) {
        const gate = await opts.mergeGate({ prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha, branch: run.branch });
        if (!gate.merge) {
          await emit({ type: "outcome", outcome: "held_for_human", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
          return { outcome: "held_for_human", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
        }
      }
      await deps.github.merge(input.owner, input.repo, pr.number);
      await emit({ type: "outcome", outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
      return { outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (status === "failure") {
      await emit({ type: "outcome", outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
      return { outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (i < opts.maxPolls - 1) await sleep(opts.pollMs);
  }
  await emit({ type: "outcome", outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
  return { outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
}
