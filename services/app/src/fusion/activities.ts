import { runFusion, type FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import { SandboxRunnerClient } from "@acp/orchestrator/sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "@acp/orchestrator/github/octokit-github-service.js";
import { makeDb } from "../db/client.js";
import { makeFusionSink, type SinkCtx } from "./events.js";

export interface RunFusionActivityInput {
  owner: string; repo: string; repoUrl: string; baseBranch: string;
  intent: string; branch: string;
  githubToken: string; sandboxUrl: string; pollMs: number; maxPolls: number;
  sink: SinkCtx;
}

export async function runChatFusionActivity(input: RunFusionActivityInput): Promise<FusionResult> {
  const { db, sql } = makeDb();
  try {
    const deps = {
      sandbox: new SandboxRunnerClient(input.sandboxUrl),
      github: new OctokitGitHubService(input.githubToken),
    };
    const sink = makeFusionSink(db, sql, input.sink);
    return await runFusion(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink });
  } finally {
    await sql.end();
  }
}
