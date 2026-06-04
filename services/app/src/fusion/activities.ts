import { runFusionTraced } from "@acp/orchestrator/telemetry/traced-fusion.js";
import type { FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import type { Autonomy } from "@acp/orchestrator/policy/policy.js";
import { makeDb } from "../db/client.js";
import { makeFusionSink, type SinkCtx } from "./events.js";
import { buildMergeGate } from "./gate.js";

export interface RunFusionActivityInput {
  owner: string; repo: string; repoUrl: string; baseBranch: string;
  intent: string; branch: string;
  githubToken: string; sandboxUrl: string; pollMs: number; maxPolls: number;
  autonomy: Autonomy;
  sink: SinkCtx;
}

export async function runChatFusionActivity(input: RunFusionActivityInput): Promise<FusionResult> {
  const { db, sql } = makeDb();
  try {
    const github = new OctokitGitHubService(input.githubToken);
    const deps = { sandbox: new SandboxRunnerClient(input.sandboxUrl), github };
    const sink = makeFusionSink(db, sql, input.sink);
    const mergeGate = buildMergeGate(github, { owner: input.owner, repo: input.repo, autonomy: input.autonomy });
    return await runFusionTraced(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink, mergeGate });
  } finally {
    await sql.end();
  }
}
