import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutomationsPanel } from "./AutomationsPanel.js";
import type { Automation } from "../api.js";

const automations: Automation[] = [
  {
    id: "au1", orgId: "acme", name: "Nightly recap",
    trigger: { type: "schedule", everyMinutes: 60 },
    action: { type: "message", threadId: "t1", body: "hi" },
    enabled: true, lastFiredAt: null, createdById: "u1", createdAt: "2026-06-05T00:00:00Z",
  },
];

describe("AutomationsPanel", () => {
  it("lists automations from the fetch (#98)", async () => {
    const listAutomations = vi.fn(async () => automations);
    render(
      <AutomationsPanel
        listAutomations={listAutomations}
        createAutomation={vi.fn()}
        setAutomationEnabled={vi.fn()}
        deleteAutomation={vi.fn()}
      />,
    );
    expect(await screen.findByText("Nightly recap")).toBeInTheDocument();
    expect(listAutomations).toHaveBeenCalled();
  });

  it("toggling enabled calls setAutomationEnabled (#98)", async () => {
    const listAutomations = vi.fn(async () => automations);
    const setAutomationEnabled = vi.fn(async () => {});
    render(
      <AutomationsPanel
        listAutomations={listAutomations}
        createAutomation={vi.fn()}
        setAutomationEnabled={setAutomationEnabled}
        deleteAutomation={vi.fn()}
      />,
    );
    await screen.findByText("Nightly recap");
    fireEvent.click(screen.getByRole("button", { name: /disable nightly recap/i }));
    await waitFor(() => expect(setAutomationEnabled).toHaveBeenCalledWith("au1", false));
  });

  it("submitting the create form calls createAutomation (#98)", async () => {
    const listAutomations = vi.fn(async () => [] as Automation[]);
    const createAutomation = vi.fn(async () => automations[0]);
    render(
      <AutomationsPanel
        listAutomations={listAutomations}
        createAutomation={createAutomation}
        setAutomationEnabled={vi.fn()}
        deleteAutomation={vi.fn()}
      />,
    );
    await waitFor(() => expect(listAutomations).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/automation name/i), { target: { value: "Hourly run" } });
    fireEvent.change(screen.getByLabelText(/every minutes/i), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/message thread id/i), { target: { value: "t9" } });
    fireEvent.change(screen.getByLabelText(/message body/i), { target: { value: "ping" } });
    fireEvent.click(screen.getByRole("button", { name: /create automation/i }));
    await waitFor(() =>
      expect(createAutomation).toHaveBeenCalledWith(
        "Hourly run",
        { type: "schedule", everyMinutes: 30 },
        { type: "message", threadId: "t9", body: "ping" },
      ),
    );
  });
});
