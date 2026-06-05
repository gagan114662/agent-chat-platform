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
  // Optional per-agent model/provider selection (#58), threaded into the sandbox
  // run/plan (and, via the app's ciFix closure, feedback). Empty = sandbox default.
  model?: string;
  provider?: string;
  // Optional per-agent built-in MCP catalog servers (#57), threaded into the
  // sandbox run/plan identically. Undefined = none.
  mcpServers?: string[];
  // Optional per-repo setup script (#71), threaded into the sandbox run (and,
  // via the app's ciFix closure, feedback). Empty/undefined = no setup. The
  // plan step never sets up (read-only, never edits/pushes).
  setupScript?: string;
  // Optional per-repo environment variables (#73), threaded into the sandbox
  // run (and, via the app's ciFix closure, feedback) — applied to the agent's
  // child env and the setup script. Undefined = none (today's behavior). The
  // plan step never receives env (read-only, never edits/pushes).
  env?: Record<string, string>;
  // Optional GitHub Enterprise base URL (#73). The app activity constructs the
  // GitHub client with this baseUrl; carried here so FusionInput stays the
  // single threaded shape. Undefined = github.com (today's behavior).
  githubApiUrl?: string;
}

export type FusionOutcome = "merged" | "checks_failed" | "timeout" | "held_for_human" | "awaiting_plan";

export type FusionEvent =
  | { type: "sandbox_started" }
  | { type: "plan_proposed"; plan: string }
  | { type: "branch_pushed"; branch: string; commitSha: string }
  | { type: "pr_opened"; prNumber: number; prUrl: string }
  | { type: "checks"; status: "pending" | "success" | "failure" }
  | { type: "ci_fix_attempt"; attempt: number; failure: string }
  | { type: "outcome"; outcome: FusionOutcome; prNumber?: number; prUrl?: string; commitSha?: string };

export interface FusionOptions {
  pollMs: number;
  maxPolls: number;
  onEvent?: (e: FusionEvent) => void | Promise<void>;
  mergeGate?: (info: { prNumber: number; prUrl: string; commitSha: string; branch: string }) => Promise<{ merge: boolean; reason: string }>;
  // Fix-on-red: when set and maxFixAttempts > 0, a failing check triggers up to
  // maxFixAttempts agent fix attempts (re-run on the same branch) before giving up.
  // Defaults keep today's behavior: maxFixAttempts 0 + no ciFix => no fix loop.
  maxFixAttempts?: number; // default 0
  ciFix?: (info: { branch: string; commitSha: string; prNumber: number; failure: string }) => Promise<{ commitSha: string }>;
  // Plan mode (#20): when planMode is set, the run first produces a read-only plan
  // and runs planGate to decide whether to proceed. If the gate is not approved,
  // the run parks at outcome "awaiting_plan" (no edits, no PR). Defaults keep
  // today's behavior: planMode false => no plan step.
  planMode?: boolean;
  planGate?: (info: { plan: string }) => Promise<{ approved: boolean }>;
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

  // Plan mode (#20): propose a read-only plan and gate on approval before any
  // edits. If not approved, park at "awaiting_plan" (approval re-triggers a fresh
  // execute run via startFusionRun — same shape as the merge-boundary gate).
  if (opts.planMode) {
    const { plan } = await deps.sandbox.plan({
      repoUrl: input.repoUrl,
      baseBranch: input.baseBranch,
      intent: input.intent,
      model: input.model,
      provider: input.provider,
      mcpServers: input.mcpServers,
    });
    await emit({ type: "plan_proposed", plan });
    const g = opts.planGate ? await opts.planGate({ plan }) : { approved: true };
    if (!g.approved) {
      await emit({ type: "outcome", outcome: "awaiting_plan" });
      return { outcome: "awaiting_plan" };
    }
  }

  await emit({ type: "sandbox_started" });
  const run = await deps.sandbox.run({
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    intent: input.intent,
    branch: input.branch,
    model: input.model,
    provider: input.provider,
    mcpServers: input.mcpServers,
    // #71: per-repo setup runs in the sandbox after clone, before the agent.
    setupScript: input.setupScript,
    // #73: per-repo env vars applied to the agent's child env + the setup script.
    env: input.env,
  });
  await emit({ type: "branch_pushed", branch: run.branch, commitSha: run.commitSha });

  const pr = await deps.github.openPr({
    owner: input.owner,
    repo: input.repo,
    head: run.branch,
    base: input.baseBranch,
    title: `agent: ${input.intent.split("\n")[0].slice(0, 72)}`,
    body: `Automated change for intent: ${input.intent}\n\nCommit: ${run.commitSha}`,
  });
  await emit({ type: "pr_opened", prNumber: pr.number, prUrl: pr.url });

  const maxFixAttempts = opts.maxFixAttempts ?? 0;
  let fixes = 0;

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
      if (opts.ciFix && fixes < maxFixAttempts) {
        fixes++;
        const failure = await deps.github.getCheckFailureContext(input.owner, input.repo, run.commitSha);
        await emit({ type: "ci_fix_attempt", attempt: fixes, failure });
        const fixed = await opts.ciFix({ branch: run.branch, commitSha: run.commitSha, prNumber: pr.number, failure });
        run.commitSha = fixed.commitSha;
        // Re-poll the new commit from scratch (fresh poll budget). `fixes` is
        // bounded by maxFixAttempts, so this can't loop forever.
        i = -1;
        continue;
      }
      await emit({ type: "outcome", outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
      return { outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (i < opts.maxPolls - 1) await sleep(opts.pollMs);
  }
  await emit({ type: "outcome", outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha });
  return { outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
}
