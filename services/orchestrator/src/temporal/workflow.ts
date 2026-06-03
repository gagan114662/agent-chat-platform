import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { FusionResult } from "../core/run-fusion.js";
import type { RunFusionActivityInput } from "./activities.js";

const { runFusionActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
});

export async function fusionWorkflow(
  input: RunFusionActivityInput,
): Promise<FusionResult> {
  return runFusionActivity(input);
}
