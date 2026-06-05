import { proxyActivities } from "@temporalio/workflow";
import type { ActivityOptions } from "@temporalio/workflow";
import type { FusionResult } from "@acp/orchestrator/core/run-fusion.js";
import type { RunFusionActivityInput } from "./activities.js";

// Run-level retry (#70): the activity's side effects are now idempotent — openPr
// is find-or-create (reuses an existing PR for the head branch) and merge tolerates
// an already-merged PR — so a transient sandbox/GitHub blip can be retried instead
// of killing the run. Exported so the retry policy is assertable in a unit (the live
// Temporal test harness needs a network download and isn't runnable in CI/sandbox).
export const fusionActivityOptions: ActivityOptions = {
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "2s",
    backoffCoefficient: 2,
  },
};

const { runChatFusionActivity } = proxyActivities<{
  runChatFusionActivity(i: RunFusionActivityInput): Promise<FusionResult>;
}>(fusionActivityOptions);

export async function chatFusionWorkflow(i: RunFusionActivityInput): Promise<FusionResult> {
  return runChatFusionActivity(i);
}
