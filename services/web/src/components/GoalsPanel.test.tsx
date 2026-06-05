import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GoalsPanel } from "./GoalsPanel.js";
import type { Goal, TickResult } from "../api.js";

describe("GoalsPanel", () => {
  it("submitting a title (and criteria) calls createGoal (#67)", async () => {
    const goal: Goal = { id: "g1", orgId: "acme", title: "Ship it", criteria: "done" };
    const createGoal = vi.fn(async () => goal);
    render(<GoalsPanel orgId="acme" createGoal={createGoal} runTick={vi.fn()} decomposeGoal={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/goal title/i), { target: { value: "Ship it" } });
    fireEvent.change(screen.getByPlaceholderText(/criteria/i), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: /create goal/i }));
    await waitFor(() => expect(createGoal).toHaveBeenCalledWith("Ship it", "done"));
    expect(await screen.findByText(/g1/)).toBeInTheDocument();
  });

  it("Run tick calls runTick and shows the dispatched/alert counts (#67)", async () => {
    const result: TickResult = { dispatched: ["run-a", "run-b"], skipped: 1, reason: "budget 5", alerts: 3, automations: 0 };
    const runTick = vi.fn(async () => result);
    render(<GoalsPanel orgId="acme" createGoal={vi.fn()} runTick={runTick} decomposeGoal={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /run tick/i }));
    await waitFor(() => expect(runTick).toHaveBeenCalledWith("acme", undefined));
    expect(await screen.findByText(/2 dispatched/)).toBeInTheDocument();
    expect(screen.getByText(/3 alerts/)).toBeInTheDocument();
  });
});
