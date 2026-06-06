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

// #85 Checkout/Portal client. A minimal Stripe surface for the billing routes:
// build a Checkout Session (upgrade) and a Billing Portal Session (manage). The
// factory is injectable so tests pass a fake returning a URL — NO live Stripe
// calls in tests. The default factory throws when STRIPE_API_KEY is unset so the
// route can answer 400 ("Stripe not configured"). Reuses the same env key +
// raw-fetch pattern as StripeMeterReporter (no Stripe SDK dependency).
export interface StripeClient {
  createCheckoutSession(args: { priceId: string; orgId: string; customerId?: string | null; successUrl?: string; cancelUrl?: string }): Promise<{ url: string }>;
  createPortalSession(args: { customerId: string; returnUrl?: string }): Promise<{ url: string }>;
  // One-time payment for an arbitrary amount (the business loop: a quote at its exact
  // quoted price). Uses ad-hoc price_data so no pre-created Stripe Price is needed —
  // the amount IS the quote, so quoted === charged holds through to Stripe.
  createPaymentSession(args: { amountCents: number; currency?: string; productName: string; clientReferenceId: string; customerEmail?: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }>;
}

export type MakeStripe = () => StripeClient;

// Live Stripe client over the REST API (form-encoded). Throws on a non-2xx.
class StripeRestClient implements StripeClient {
  constructor(private readonly apiKey: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async post(path: string, form: URLSearchParams): Promise<{ url: string }> {
    const res = await this.fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`stripe ${path} ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new Error(`stripe ${path}: no url in response`);
    return { url: json.url };
  }

  async createCheckoutSession(args: { priceId: string; orgId: string; customerId?: string | null; successUrl?: string; cancelUrl?: string }): Promise<{ url: string }> {
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", args.priceId);
    form.set("line_items[0][quantity]", "1");
    form.set("client_reference_id", args.orgId);
    if (args.customerId) form.set("customer", args.customerId);
    form.set("success_url", args.successUrl ?? "https://reload.chat/billing?status=success");
    form.set("cancel_url", args.cancelUrl ?? "https://reload.chat/billing?status=cancel");
    return this.post("checkout/sessions", form);
  }

  async createPortalSession(args: { customerId: string; returnUrl?: string }): Promise<{ url: string }> {
    const form = new URLSearchParams();
    form.set("customer", args.customerId);
    form.set("return_url", args.returnUrl ?? "https://reload.chat/billing");
    return this.post("billing_portal/sessions", form);
  }

  async createPaymentSession(args: { amountCents: number; currency?: string; productName: string; clientReferenceId: string; customerEmail?: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }> {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", args.currency ?? "usd");
    form.set("line_items[0][price_data][unit_amount]", String(Math.round(args.amountCents)));
    form.set("line_items[0][price_data][product_data][name]", args.productName);
    form.set("client_reference_id", args.clientReferenceId);
    if (args.customerEmail) form.set("customer_email", args.customerEmail);
    form.set("success_url", args.successUrl);
    form.set("cancel_url", args.cancelUrl);
    const res = await this.fetchImpl(`https://api.stripe.com/v1/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`stripe checkout/sessions ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { id?: string; url?: string };
    if (!json.id || !json.url) throw new Error("stripe checkout/sessions: missing id/url");
    return { id: json.id, url: json.url };
  }
}

// defaultStripe builds the live client from STRIPE_API_KEY. It THROWS when the
// key is unset so the route can map that to a 400 ("Stripe not configured").
export const defaultStripe: MakeStripe = () => {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("Stripe not configured (STRIPE_API_KEY unset)");
  return new StripeRestClient(key);
};
