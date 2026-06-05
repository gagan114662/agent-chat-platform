import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BillingPanel } from "./BillingPanel.js";
import type { Billing, Plan } from "../api.js";

const billing: Billing = {
  plan: { id: "starter", name: "Starter", seatLimit: 3, agentLimit: 2, messageQuota: 1000, taskQuota: 100, stripePriceId: null },
  usage: { seats: 1, agents: 1, messages: 42, tasks: 5 },
  quotas: {
    seats: { used: 1, limit: 3, ok: true },
    agents: { used: 1, limit: 2, ok: true },
    messages: { used: 42, limit: 1000, ok: true },
    tasks: { used: 5, limit: 100, ok: true },
  },
};

const plans: Plan[] = [
  { id: "starter", name: "Starter", seatLimit: 3, agentLimit: 2, messageQuota: 1000, taskQuota: 100, stripePriceId: null },
  { id: "pro", name: "Pro", seatLimit: 10, agentLimit: 10, messageQuota: 100000, taskQuota: 10000, stripePriceId: "price_pro" },
];

describe("BillingPanel", () => {
  it("renders the current plan + a quota row from the fetch (#85)", async () => {
    const getBilling = vi.fn(async () => billing);
    const listPlans = vi.fn(async () => plans);
    render(<BillingPanel getBilling={getBilling} listPlans={listPlans} billingCheckout={vi.fn()} />);
    // current plan name — there's a dedicated "Current plan: Starter" line
    expect(await screen.findByText(/current plan/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Starter/).length).toBeGreaterThan(0);
    // a quota row: messages used/limit
    const messagesRow = await screen.findByLabelText("quota messages");
    expect(messagesRow).toHaveTextContent("42");
    expect(messagesRow).toHaveTextContent("1000");
    expect(getBilling).toHaveBeenCalled();
  });

  it("clicking Upgrade calls billingCheckout with the plan id (#85)", async () => {
    const getBilling = vi.fn(async () => billing);
    const listPlans = vi.fn(async () => plans);
    const billingCheckout = vi.fn(async () => ({ url: "https://checkout.stripe.test/abc" }));
    render(<BillingPanel getBilling={getBilling} listPlans={listPlans} billingCheckout={billingCheckout} redirect={vi.fn()} />);
    await screen.findByText(/Pro/);
    fireEvent.click(screen.getByRole("button", { name: /upgrade to pro/i }));
    await waitFor(() => expect(billingCheckout).toHaveBeenCalledWith("pro"));
  });
});
