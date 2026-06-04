import type { Client } from "@temporalio/client";
import { startRun } from "./bridge.js";

// The repo fields the fusion starter needs. The GitHub PAT is NEVER passed (only the
// env var NAME, resolved inside the activity — see #36 / RunFusionActivityInput).
export interface StartRepo {
  githubOwner: string;
  githubName: string;
  defaultBranch: string;
  tokenEnvVar: string;
  autonomy: string;
}

export interface StartFusionRunInput {
  run: { id: string; workflowId: string };
  orgId: string;
  threadId: string;
  repo: StartRepo;
  agentId: string;
  intent: string;
  sandboxUrl: string;
  // Plan mode (#20): when true, the run proposes a read-only plan and parks at
  // awaiting_plan_approval instead of executing. Defaults false (execute now).
  planMode?: boolean;
  // #27 mention loop guard: the depth of this run in an agent↔agent mention chain.
  // A human-triggered run is depth 0; a run started by an agent's @mention carries
  // the parent's depth + 1. Threaded into the sink ctx so when this run later
  // authors a coordinating @mention it can pass its own depth (bounded by MAX_DEPTH).
  mentionDepth?: number;
}

// Shared starter: builds the RunFusionActivityInput and kicks off the fusion workflow.
// Used by BOTH the mention handler and the task hand-off route so the two paths stay
// in lockstep.
export async function startFusionRun(temporal: Client, i: StartFusionRunInput) {
  await startRun(temporal, i.run.workflowId, {
    owner: i.repo.githubOwner, repo: i.repo.githubName,
    baseBranch: i.repo.defaultBranch, intent: i.intent, branch: `agent/${i.run.id}`,
    tokenEnvVar: i.repo.tokenEnvVar, sandboxUrl: i.sandboxUrl, pollMs: 5000, maxPolls: 24,
    autonomy: (i.repo.autonomy as "monitor-only" | "resolve-ci" | "autopilot-merge"),
    planMode: i.planMode ?? false,
    sink: { orgId: i.orgId, threadId: i.threadId, runId: i.run.id, agentId: i.agentId, mentionDepth: i.mentionDepth ?? 0 },
  });
}
