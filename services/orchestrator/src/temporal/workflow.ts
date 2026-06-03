import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { FusionResult } from "../core/run-fusion.js";
import type { RunFusionActivityInput } from "./activities.js";

// CAUTION (skeleton scope; hardened in Plan 4): `startToCloseTimeout` must stay
// larger than the activity's worst-case runtime (sandbox run + PR open +
// maxPolls*pollMs), or Temporal will kill it mid-poll. Because the activity is
// NOT idempotent (it opens a GitHub PR), a timeout/transient-failure retry under
// `maximumAttempts: 3` can re-run the whole fusion and open duplicate PRs. Plan 4
// adds idempotency + derives the timeout from the poll budget.
const { runFusionActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
});

export async function fusionWorkflow(
  input: RunFusionActivityInput,
): Promise<FusionResult> {
  return runFusionActivity(input);
}
