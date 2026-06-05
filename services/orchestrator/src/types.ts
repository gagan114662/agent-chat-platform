export interface RunResult {
  branch: string;
  commitSha: string;
}

export interface SandboxRunRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
  // #104 per-agent adapter (claude-code | codex | fake). Undefined = sandbox default.
  adapter?: string;
  // Optional per-agent model/provider selection (#58). Empty = sandbox default.
  model?: string;
  provider?: string;
  // Optional per-agent built-in MCP catalog servers (#57). Undefined = none.
  mcpServers?: string[];
  // #71 per-repo setup script run in the sandbox workdir after clone, before the
  // agent. Optional; empty/undefined = no setup (today's behavior). Trusted repo
  // config only (never cloned content).
  setupScript?: string;
  // #73 per-repo environment variables applied to the agent's child env (after
  // the #49 scrub — an intentional admin override) AND to the setup script.
  // Optional; undefined = none (today's behavior). Trusted repo config only.
  env?: Record<string, string>;
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
  // #73 per-repo environment variables (see SandboxRunRequest). Applied to the
  // agent's child env and the setup script on the feedback re-run too.
  env?: Record<string, string>;
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

export interface SandboxExecRequest {
  repoUrl: string;
  baseBranch: string;
  command: string;
}

export interface ExecResult {
  output: string;
  exitCode: number;
}

export type ChecksStatus = "pending" | "success" | "failure";

export interface PullRequest {
  number: number;
  url: string;
}
