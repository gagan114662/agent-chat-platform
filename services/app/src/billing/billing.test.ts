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
    expect(decodeURIComponent(body)).toContain("payload[stripe_customer_id]=cus_123");
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
