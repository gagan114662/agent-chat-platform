export interface RunUsage { eventName: string; quantity: number; }

// One metered "agent_run" per terminal Run. (Compute-seconds / LLM tokens can be added later
// once the runner reports them; the unit here is the run.)
export function runUsage(_outcome: string): RunUsage {
  return { eventName: "agent_run", quantity: 1 };
}

export interface ReportInput {
  orgId: string;
  runId: string;
  stripeCustomerId?: string | null;
  usage: RunUsage;
}

export interface BillingReporter {
  reportRun(input: ReportInput): Promise<void>;
}

// Default: do nothing (no Stripe configured).
export const noopReporter: BillingReporter = { async reportRun() {} };

// Reports a Stripe meter event per run. Idempotent by run id. `fetch` is injected for tests.
export class StripeMeterReporter implements BillingReporter {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async reportRun(input: ReportInput): Promise<void> {
    if (!input.stripeCustomerId) return; // no tenant→customer mapping yet — skip
    const body = new URLSearchParams();
    body.set("event_name", input.usage.eventName);
    body.set("payload[stripe_customer_id]", input.stripeCustomerId);
    body.set("payload[value]", String(input.usage.quantity));
    const res = await this.fetchImpl("https://api.stripe.com/v1/billing/meter_events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `run-${input.runId}`,
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`stripe meter_events ${res.status}: ${await res.text()}`);
  }
}

// Build the reporter from env: a real Stripe reporter when STRIPE_API_KEY is set, else noop.
export function reporterFromEnv(): BillingReporter {
  const key = process.env.STRIPE_API_KEY;
  return key ? new StripeMeterReporter(key) : noopReporter;
}
