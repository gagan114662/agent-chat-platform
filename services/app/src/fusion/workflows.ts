import { proxyActivities } from "@temporalio/workflow";
import type { FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import type { RunFusionActivityInput } from "./activities.js";

const { runChatFusionActivity } = proxyActivities<{
  runChatFusionActivity(i: RunFusionActivityInput): Promise<FusionResult>;
}>({ startToCloseTimeout: "15 minutes", retry: { maximumAttempts: 1 } });

// maximumAttempts:1 — the activity is NOT idempotent (opens a PR); run-level retry is a later plan.
export async function chatFusionWorkflow(i: RunFusionActivityInput): Promise<FusionResult> {
  return runChatFusionActivity(i);
}
