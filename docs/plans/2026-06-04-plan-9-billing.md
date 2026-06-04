# Plan 9 — Stripe Metering / Usage Billing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** Meter usage per Run and report it to Stripe (spec §6 "metered per Run"). A `billing` module with a `BillingReporter` interface — `noopReporter` (default, when no key) and `StripeMeterReporter` (POSTs Stripe **meter events**, injectable `fetch` for tests). `orgs.stripeCustomerId` maps a tenant to a Stripe customer. The activity reports usage on each terminal Run (best-effort — billing never fails a run). App tests use a fake (no Stripe network); a live smoke goes through the authed Stripe CLI (test mode).

**Tech Stack:** TS. Branch `plan-9-billing` (off `main`). Postgres at `postgres://acp:acp@localhost:5432/acp`. Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: `billing` module

**Files:** Create `services/app/src/billing/billing.ts`, `src/billing/billing.test.ts`

- [ ] **Step 1: failing test** `src/billing/billing.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runUsage, noopReporter, StripeMeterReporter } from "./billing.js";

describe("billing", () => {
  it("runUsage → 1 agent_run unit per terminal run", () => {
    expect(runUsage("merged")).toEqual({ eventName: "agent_run", quantity: 1 });
    expect(runUsage("held_for_human")).toEqual({ eventName: "agent_run", quantity: 1 });
  });

  it("noopReporter does nothing", async () => {
    await expect(noopReporter.reportRun({ orgId: "o1", runId: "r1", usage: runUsage("merged") })).resolves.toBeUndefined();
  });

  it("StripeMeterReporter posts a meter event with customer + value + idempotency", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch;
    const r = new StripeMeterReporter("sk_test_x", f);
    await r.reportRun({ orgId: "o1", runId: "run-7", stripeCustomerId: "cus_123", usage: runUsage("merged") });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/billing/meter_events");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as string;
    expect(body).toContain("event_name=agent_run");
    expect(body).toContain("stripe_customer_id%5D=cus_123".toLowerCase()).valueOf(); // payload[stripe_customer_id]=cus_123 (url-encoded)
    expect(body).toMatch(/value(%5D|\])=1/);
    expect((init as RequestInit).headers).toMatchObject({ "Idempotency-Key": "run-run-7" });
  });

  it("StripeMeterReporter skips when there is no customer mapping", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    await new StripeMeterReporter("sk_test_x", f).reportRun({ orgId: "o1", runId: "r1", usage: runUsage("merged") });
    expect(f).not.toHaveBeenCalled();
  });

  it("StripeMeterReporter throws on a non-2xx", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 402, text: async () => "boom" })) as unknown as typeof fetch;
    await expect(new StripeMeterReporter("sk_test_x", f).reportRun({ orgId: "o1", runId: "r1", stripeCustomerId: "cus_1", usage: runUsage("merged") }))
      .rejects.toThrow(/stripe meter_events 402/);
  });
});
```
> If the `.toContain(...).valueOf()` line is awkward, simplify that one assertion to `expect(decodeURIComponent(body)).toContain("payload[stripe_customer_id]=cus_123")` — keep the intent (customer in the payload).

- [ ] **Step 2:** `cd services/app && pnpm test -- billing/billing` → FAIL. Then implement `src/billing/billing.ts`:
```ts
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
```

- [ ] **Step 3:** `pnpm test -- billing/billing` → PASS; suite + tsc clean.
- [ ] **Step 4:** commit:
```bash
git add services/app/src/billing
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): billing module (usage metering + Stripe meter-event reporter)"
```

---

## Task 1: `orgs.stripeCustomerId` + report on terminal Run

**Files:** Modify `services/app/src/db/schema.ts`; Create `src/billing/report.ts`, `src/billing/report.test.ts`; Modify `src/fusion/activities.ts`

- [ ] **Step 1:** add `stripeCustomerId` (nullable) to `orgs` in `schema.ts`:
```ts
export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
});
```
`cd services/app && DATABASE_URL=postgres://acp:acp@localhost:5432/acp pnpm db:generate && DATABASE_URL=... pnpm db:migrate` — paste the migration filename.

- [ ] **Step 2: failing test** `src/billing/report.test.ts`:
```ts
import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { reportRunUsage } from "./report.js";
import { orgs } from "../db/schema.js";
import type { BillingReporter } from "./billing.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("reportRunUsage", () => {
  it("resolves the org's stripe customer and reports usage", async () => {
    await h.db.insert(orgs).values({ id: "o1", name: "O", stripeCustomerId: "cus_42" });
    const reporter: BillingReporter = { reportRun: vi.fn(async () => {}) };
    await reportRunUsage(h.db, reporter, { orgId: "o1", runId: "r1", outcome: "merged" });
    expect(reporter.reportRun).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "o1", runId: "r1", stripeCustomerId: "cus_42",
      usage: { eventName: "agent_run", quantity: 1 },
    }));
  });

  it("never throws even if the reporter fails (best-effort billing)", async () => {
    await h.db.insert(orgs).values({ id: "o1", name: "O" });
    const reporter: BillingReporter = { reportRun: vi.fn(async () => { throw new Error("stripe down"); }) };
    await expect(reportRunUsage(h.db, reporter, { orgId: "o1", runId: "r1", outcome: "merged" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3:** run → FAIL. Then implement `src/billing/report.ts`:
```ts
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
```

- [ ] **Step 4: Wire into `src/fusion/activities.ts`** — report usage after the run completes (best-effort). Add imports and call after `runFusionTraced`:
```ts
import { reporterFromEnv } from "../billing/billing.js";
import { reportRunUsage } from "../billing/report.js";
// in runChatFusionActivity, change the return to capture + report:
    const result = await runFusionTraced(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls, onEvent: sink, mergeGate });
    await reportRunUsage(db, reporterFromEnv(), { orgId: input.sink.orgId, runId: input.sink.runId, outcome: result.outcome });
    return result;
```
(`db` is already created at the top of the activity; keep the `finally { await sql.end(); }`.)

- [ ] **Step 5:** `DATABASE_URL=... pnpm test -- billing` (billing + report pass) + whole app suite + tsc clean. The integration test still passes (no `STRIPE_API_KEY` → noop reporter; org has no customer → skip).
- [ ] **Step 6:** commit:
```bash
git add services/app/src/db/schema.ts services/app/migrations services/app/src/billing/report.ts services/app/src/billing/report.test.ts services/app/src/fusion/activities.ts
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(app): orgs.stripeCustomerId + report run usage to billing on terminal run"
```

---

## Self-Review
- Coverage: usage metering + Stripe meter-event reporter (T0), tenant→customer mapping + best-effort reporting wired into the activity (T1). Spec §6 "metered per Run".
- Backward-compat: default `reporterFromEnv()` → noop without `STRIPE_API_KEY`; reporting is best-effort (swallows errors) so it can't break a run. Existing tests pass (no key, no customer). The `orgs` column is additive (nullable).
- Deferred: org→Stripe-customer provisioning (creating customers/subscriptions), richer cost model (compute-seconds, LLM tokens), invoicing UI. The app's real `StripeMeterReporter` needs `STRIPE_API_KEY` (test/restricted) at deploy — documented.

## Definition of Done (9)
App suite green (Postgres + migration) incl. billing + report tests; tsc clean. With `STRIPE_API_KEY` + an org's `stripeCustomerId`, each terminal Run posts an `agent_run` meter event to Stripe (idempotent by run id). A live smoke through the authed Stripe CLI (test mode) confirms the meter-event flow against the real account.
