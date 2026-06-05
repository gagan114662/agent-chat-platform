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
import { agentPrefs } from "../agents/agents.js";
import { agents, runs, tasks } from "../db/schema.js";
import { recordOutcome } from "../delegation/reputation-store.js";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";

// Augments the intent the AGENT sees with: the agent's configured persona
// (#74 systemPrompt as a leading "## Instructions" block), the original task,
// the agent's context-directory focus (#74 contextDirs hint), and a recalled
// org-memory preamble (#26). Order: systemPrompt → task intent → focus dirs →
// recalled memory. The TASK line stays the FIRST task line when there's no
// systemPrompt (so the orchestrator PR title — first line only — remains clean);
// when a systemPrompt is configured it leads, with the task preserved verbatim
// just below it. Returns the original intent unchanged when there's neither
// prefs nor matching memory. Org-scoped; agentId optional (omit = no prefs).
export async function buildAgentIntent(db: DB, orgId: string, intent: string, agentId?: string): Promise<string> {
  let prefs: ReturnType<typeof agentPrefs> = {};
  if (agentId) {
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)));
    prefs = agentPrefs(agent);
  }
  const recalled = await recallForIntent(db, orgId, intent);
  const preamble = formatRecall(recalled);

  const parts: string[] = [];
  if (prefs.systemPrompt) parts.push(`## Instructions\n${prefs.systemPrompt}`);
  parts.push(intent);
  if (prefs.contextDirs && prefs.contextDirs.length > 0) {
    parts.push(`## Focus directories: ${prefs.contextDirs.join(", ")}`);
  }
  if (preamble) parts.push(preamble);
  return parts.join("\n\n");
}

export interface RunFusionActivityInput {
  owner: string; repo: string; baseBranch: string;
  intent: string; branch: string;
  // SECURITY (#36): the GitHub PAT is NEVER passed in the workflow args (it would be
  // persisted in Temporal history). We pass only the env var NAME and resolve the
  // token inside the activity, where the worker shares the app's environment.
  tokenEnvVar: string; sandboxUrl: string; pollMs: number; maxPolls: number;
  autonomy: Autonomy;
  // #104 per-agent adapter (claude-code | codex | fake), threaded into the sandbox
  // run + ciFix feedback so a real mention runs the agent's CLI. Undefined = default.
  adapter?: string;
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
    // #26/#74: feed the agent's configured persona/scope (#74 systemPrompt +
    // contextDirs) and recalled org memory (#26) into the intent the agent sees
    // (the task line stays clean → PR title clean). captureDecision below still
    // records against the original input.intent.
    const agentIntent = await buildAgentIntent(db, input.sink.orgId, input.intent, input.sink.agentId);
    const fusionInput = {
      owner: input.owner, repo: input.repo, repoUrl,
      baseBranch: input.baseBranch, intent: agentIntent, branch: input.branch,
      // #104: thread the per-agent adapter (claude-code/codex/fake) into the run.
      adapter: input.adapter,
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
      const res = await sandbox.feedback({ repoUrl, branch, notes: failure, adapter: input.adapter, model: input.model, provider: input.provider, mcpServers: input.mcpServers, setupScript: input.setupScript, env: input.env });
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
    // #128 reputation + #129 adaptive coordination, at the outcome boundary: a
    // decisive outcome updates the assignee's track record, and a failed run
    // escalates its task to "blocked" (visible on the board) instead of leaving it
    // stuck "in_progress" — the silent-stall failure mode.
    const decisive: Record<string, "success" | "fail"> = { merged: "success", checks_failed: "fail", timeout: "fail", error: "fail" };
    const rep = decisive[result.outcome];
    if (rep && input.sink.agentId) {
      await recordOutcome(db, input.sink.orgId, input.sink.agentId, rep);
    }
    if (rep === "fail") {
      const [run] = await db.select().from(runs).where(and(eq(runs.id, input.sink.runId), eq(runs.orgId, input.sink.orgId)));
      if (run?.taskId) {
        await db.update(tasks).set({ state: "blocked" })
          .where(and(eq(tasks.id, run.taskId), eq(tasks.orgId, input.sink.orgId), eq(tasks.state, "in_progress")));
      }
    }
    return result;
  } finally {
    await sql.end();
  }
}
