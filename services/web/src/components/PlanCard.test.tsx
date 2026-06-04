import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanCard } from "./PlanCard.js";
import type { Message } from "../types.js";

const base = { id: "x", orgId: "o1", threadId: "t1", authorKind: "agent", authorId: "a", kind: "plan_card", createdAt: new Date(0).toISOString() } as const;

function planMsg(): Message {
  return { ...base, body: "1. step one\n2. step two", metadata: { runId: "run1", kind: "plan" } } as Message;
}

describe("PlanCard", () => {
  it("renders the plan text and both buttons", () => {
    render(<PlanCard message={planMsg()} />);
    expect(screen.getByText(/step one/)).toBeInTheDocument();
    expect(screen.getByText(/step two/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("clicking Approve calls onApprove with the runId", () => {
    const onApprove = vi.fn();
    render(<PlanCard message={planMsg()} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("run1");
  });

  it("typing a note + Reject calls onReject with the runId and notes", () => {
    const onReject = vi.fn();
    render(<PlanCard message={planMsg()} onReject={onReject} />);
    fireEvent.change(screen.getByLabelText(/steering note/i), { target: { value: "do X instead" } });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith("run1", "do X instead");
  });

  it("Reject with no note passes undefined notes", () => {
    const onReject = vi.fn();
    render(<PlanCard message={planMsg()} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith("run1", undefined);
  });
});
