export interface RunResult {
  branch: string;
  commitSha: string;
}

export interface SandboxRunRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
}

export interface SandboxFeedbackRequest {
  repoUrl: string;
  branch: string;
  notes: string;
  adapter?: string;
}

export type ChecksStatus = "pending" | "success" | "failure";

export interface PullRequest {
  number: number;
  url: string;
}
