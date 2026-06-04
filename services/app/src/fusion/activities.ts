import { runFusionTraced } from "@acp/orchestrator/telemetry/traced-fusion.js";
import type { FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { Autonomy } from "@acp/orchestrator/policy/policy.js";
import { makeDb } from "../db/client.js";
import { makeFusionSink, type SinkCtx } from "./events.js";
import { buildMergeGate } from "./gate.js";
import { reporterFromEnv } from "../billing/billing.js";
import { reportRunUsage } from "../billing/report.js";
import { captureDecision } from "../memory/capture.js";

export interface RunFusionActivityInput {
  owner: string; repo: string; baseBranch: string;
  intent: string; branch: string;
  // SECURITY (#36): the GitHub PAT is NEVER passed in the workflow args (it would be
  // persisted in Temporal history). We pass only the env var NAME and resolve the
  // token inside the activity, where the worker shares the app's environment.
  tokenEnvVar: string; sandboxUrl: string; pollMs: number; maxPolls: number;
  autonomy: Autonomy;
  sink: SinkCtx;
}

export async function runChatFusionActivity(input: RunFusionActivityInput): Promise<FusionResult> {
  const token = process.env[input.tokenEnvVar];
  if (!token) throw new Error(`GitHub token not found in env var: ${input.tokenEnvVar}`);
  const repoUrl = `https://x-access-token:${token}@github.com/${input.owner}/${input.repo}.git`;

  const { db, sql } = makeDb();
  try {
    const github = new OctokitGitHubService(token);
    const deps = { sandbox: new SandboxRunnerClient(input.sandboxUrl), github };
    const sink = makeFusionSink(db, sql, input.sink);
    const mergeGate = buildMergeGate(github, { owner: input.owner, repo: input.repo, autonomy: input.autonomy });
    const fusionInput = {
      owner: input.owner, repo: input.repo, repoUrl,
      baseBranch: input.baseBranch, intent: input.intent, branch: input.branch,
    };
    const result = await runFusionTraced(deps, fusionInput, { pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink, mergeGate });
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
