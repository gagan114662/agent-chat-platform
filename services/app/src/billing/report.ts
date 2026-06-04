import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { orgs } from "../db/schema.js";
import { runUsage, type BillingReporter } from "./billing.js";

// Best-effort: resolve the org's Stripe customer and report the run's usage.
// Billing problems must NEVER fail a fusion run, so all errors are swallowed (logged).
export async function reportRunUsage(
  db: DB,
  reporter: BillingReporter,
  input: { orgId: string; runId: string; outcome: string },
): Promise<void> {
  try {
    const [org] = await db.select().from(orgs).where(eq(orgs.id, input.orgId));
    await reporter.reportRun({
      orgId: input.orgId,
      runId: input.runId,
      stripeCustomerId: org?.stripeCustomerId,
      usage: runUsage(input.outcome),
    });
  } catch (e) {
    console.warn(`billing: failed to report run ${input.runId}:`, (e as Error).message);
  }
}
