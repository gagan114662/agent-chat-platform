export interface RunResult {
  branch: string;
  commitSha: string;
}

export interface SandboxRunRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
  // Optional per-agent model/provider selection (#58). Empty = sandbox default.
  model?: string;
  provider?: string;
}

export interface SandboxFeedbackRequest {
  repoUrl: string;
  branch: string;
  notes: string;
  adapter?: string;
  model?: string;
  provider?: string;
}

export interface SandboxPlanRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  adapter?: string;
  model?: string;
  provider?: string;
}

export interface PlanResult {
  plan: string;
}

export type ChecksStatus = "pending" | "success" | "failure";

export interface PullRequest {
  number: number;
  url: string;
}
