import { runFusionTraced } from "@acp/orchestrator/telemetry/traced-fusion.js";
import type { FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { Autonomy } from "@acp/orchestrator/policy/policy.js";
import { makeDb } from "../db/client.js";
import { makeFusionSink, type SinkCtx } from "./events.js";
import { fireEventAutomations } from "../autonomy/automations.js";
import { lazyTemporalClient } from "./bridge.js";
import { buildMergeGate } from "./gate.js";
import { reporterFromEnv } from "../billing/billing.js";
import { reportRunUsage } from "../billing/report.js";
import { captureDecision } from "../memory/capture.js";
import { recallForIntent, formatRecall } from "../memory/memory.js";
import type { DB } from "../db/client.js";

// Augments the intent the AGENT sees with a recalled-context preamble so prior
// org decisions/facts inform a new run. The FIRST line stays the original task
// (so the orchestrator PR title — first line only — remains clean). Returns the
// original intent unchanged when there's no matching memory. Org-scoped.
export async function buildAgentIntent(db: DB, orgId: string, intent: string): Promise<string> {
  const recalled = await recallForIntent(db, orgId, intent);
  const preamble = formatRecall(recalled);
  return preamble ? `${intent}\n\n${preamble}` : intent;
}

export interface RunFusionActivityInput {
  owner: string; repo: string; baseBranch: string;
  intent: string; branch: string;
  // SECURITY (#36): the GitHub PAT is NEVER passed in the workflow args (it would be
  // persisted in Temporal history). We pass only the env var NAME and resolve the
  // token inside the activity, where the worker shares the app's environment.
  tokenEnvVar: string; sandboxUrl: string; pollMs: number; maxPolls: number;
  autonomy: Autonomy;
  // Plan mode (#20): when true, the run proposes a read-only plan and parks
  // (the planGate below always declines the first pass — approval comes via the
  // approve-plan route, which starts a fresh execute run with planMode off).
  planMode?: boolean;
  // #58 per-agent model/provider selection, threaded into the sandbox run/plan
  // and the ciFix feedback. Optional; empty = the sandbox default (today's behavior).
  model?: string;
  provider?: string;
  // #57 per-agent MCP servers, threaded into the sandbox run/plan and the ciFix
  // feedback identically. Optional; undefined = no MCP servers (today's behavior).
  mcpServers?: string[];
  // #71 per-repo setup script (from repos.setupScript), threaded into the sandbox
  // run and the ciFix feedback. Optional; empty/undefined = no setup.
  setupScript?: string;
  // #73 per-repo environment variables (from repos.envVars), threaded into the
  // sandbox run and the ciFix feedback — applied to the agent's child env and
  // the setup script. Optional; undefined = none (today's behavior).
  env?: Record<string, string>;
  // #73 GitHub Enterprise base URL (from repos.githubApiUrl). When set, the
  // GitHub client is built against this host's API root. Optional; undefined =
  // github.com (today's behavior).
  githubApiUrl?: string;
  sink: SinkCtx;
}

// Injectable factories so the activity can be unit-tested without a real GitHub
// host or sandbox-runner. Production defaults construct the real clients.
export interface RunFusionActivityDeps {
  githubFactory?: (token: string, baseUrl?: string) => OctokitGitHubService;
  sandboxFactory?: (baseUrl: string) => SandboxRunnerClient;
}

export async function runChatFusionActivity(
  input: RunFusionActivityInput,
  factories: RunFusionActivityDeps = {},
): Promise<FusionResult> {
  const token = process.env[input.tokenEnvVar];
  if (!token) throw new Error(`GitHub token not found in env var: ${input.tokenEnvVar}`);
  const repoUrl = `https://x-access-token:${token}@github.com/${input.owner}/${input.repo}.git`;

  const { db, sql } = makeDb();
  try {
    // #73: build the GitHub client against the repo's GHE host when set
    // (undefined = github.com). Factory injectable for tests.
    const github = (factories.githubFactory ?? ((t: string, b?: string) => new OctokitGitHubService(t, b)))(token, input.githubApiUrl);
    const sandbox = (factories.sandboxFactory ?? ((b: string) => new SandboxRunnerClient(b)))(input.sandboxUrl);
    const deps = { sandbox, github };
    // #98 best-effort event-automation hook: on an outcome the sink fires matching
    // user event automations (message posts, or guarded run dispatches). A lazy
    // temporal client backs run-actions; the hook is guarded inside the sink so a
    // failure can't break message delivery / the run-state transition.
    const sink = makeFusionSink(db, sql, input.sink, {
      fireEvents: (event) => fireEventAutomations(db, {
        db, sql, temporal: lazyTemporalClient(), sandboxUrl: input.sandboxUrl,
      }, { orgId: input.sink.orgId, event }).then(() => undefined),
    });
    const mergeGate = buildMergeGate(github, { owner: input.owner, repo: input.repo, autonomy: input.autonomy });
    // #26: feed recalled org memory into the intent the agent sees (first line
    // stays the original task → PR title stays clean). captureDecision below still
    // records against the original input.intent.
    const agentIntent = await buildAgentIntent(db, input.sink.orgId, input.intent);
    const fusionInput = {
      owner: input.owner, repo: input.repo, repoUrl,
      baseBranch: input.baseBranch, intent: agentIntent, branch: input.branch,
      // #58: thread the per-agent model/provider selection (undefined = default).
      model: input.model, provider: input.provider,
      // #57: thread the per-agent MCP servers (undefined = none).
      mcpServers: input.mcpServers,
      // #71: thread the per-repo setup script (undefined = no setup).
      setupScript: input.setupScript,
      // #73: thread the per-repo env vars (undefined = none) + GHE base URL.
      env: input.env,
      githubApiUrl: input.githubApiUrl,
    };
    // Fix-on-red: on a red PR, re-run the agent on the same branch with the CI
    // failure as feedback. Bounded by CI_FIX_ATTEMPTS (default 2; 0 disables).
    const maxFixAttempts = Number(process.env.CI_FIX_ATTEMPTS ?? 2);
    const ciFix = async ({ branch, failure }: { branch: string; failure: string }) => {
      const res = await sandbox.feedback({ repoUrl, branch, notes: failure, model: input.model, provider: input.provider, mcpServers: input.mcpServers, setupScript: input.setupScript, env: input.env });
      return { commitSha: res.commitSha };
    };
    // Plan mode: the first pass only PROPOSES a plan and parks. The planGate
    // always declines so runFusion emits outcome "awaiting_plan" → the sink
    // transitions the run to awaiting_plan_approval. Approval is handled by the
    // approve-plan route, which starts a NEW run with planMode forced off.
    const planGate = async () => ({ approved: false });
    const result = await runFusionTraced(deps, fusionInput, {
      pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink, mergeGate,
      maxFixAttempts, ciFix,
      planMode: input.planMode ?? false, planGate,
    });
    await reportRunUsage(db, reporterFromEnv(), { orgId: input.sink.orgId, runId: input.sink.runId, outcome: result.outcome });
    await captureDecision(db, {
      orgId: input.sink.orgId, runId: input.sink.runId, agentId: input.sink.agentId, threadId: input.sink.threadId,
      intent: input.intent, outcome: result.outcome, prNumber: result.prNumber,
    });
    return result;
  } finally {
    await sql.end();
  }
}
