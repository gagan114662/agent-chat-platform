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
  // Optional per-agent built-in MCP catalog servers (#57). Undefined = none.
  mcpServers?: string[];
  // #71 per-repo setup script run in the sandbox workdir after clone, before the
  // agent. Optional; empty/undefined = no setup (today's behavior). Trusted repo
  // config only (never cloned content).
  setupScript?: string;
}

export interface SandboxFeedbackRequest {
  repoUrl: string;
  branch: string;
  notes: string;
  adapter?: string;
  model?: string;
  provider?: string;
  mcpServers?: string[];
  // #71 per-repo setup script (see SandboxRunRequest). Re-run before the agent
  // re-applies feedback so the prepared repo (deps/build) is present.
  setupScript?: string;
}

export interface SandboxPlanRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  adapter?: string;
  model?: string;
  provider?: string;
  mcpServers?: string[];
}

export interface PlanResult {
  plan: string;
}

export type ChecksStatus = "pending" | "success" | "failure";

export interface PullRequest {
  number: number;
  url: string;
}
