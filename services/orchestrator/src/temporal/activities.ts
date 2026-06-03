import { SandboxRunnerClient } from "../sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "../github/octokit-github-service.js";
import { runFusion, type FusionInput, type FusionResult } from "../core/run-fusion.js";

export interface RunFusionActivityInput extends FusionInput {
  githubToken: string;
  sandboxUrl: string;
  pollMs: number;
  maxPolls: number;
}

export async function runFusionActivity(
  input: RunFusionActivityInput,
): Promise<FusionResult> {
  const deps = {
    sandbox: new SandboxRunnerClient(input.sandboxUrl),
    github: new OctokitGitHubService(input.githubToken),
  };
  return runFusion(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls });
}
