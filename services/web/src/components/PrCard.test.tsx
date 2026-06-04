import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrCard } from "./PrCard.js";
import type { Message } from "../types.js";

const base = { id: "x", orgId: "o1", threadId: "t1", authorKind: "agent", authorId: "a", kind: "pr_card", createdAt: new Date(0).toISOString() } as const;

describe("PrCard approve/decline", () => {
  it("shows Approve/Decline for a held_for_human card with a runId", () => {
    render(<PrCard message={{ ...base, body: "🔶 held for human review — PR #7", metadata: { outcome: "held_for_human", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /decline/i })).toBeInTheDocument();
  });

  it("clicking Approve calls onApprove with the runId", () => {
    const onApprove = vi.fn();
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7, runId: "run1" } } as Message} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("run1");
  });

  it("clicking Decline calls onDecline with the runId", () => {
    const onDecline = vi.fn();
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7, runId: "run1" } } as Message} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(onDecline).toHaveBeenCalledWith("run1");
  });

  it("shows no buttons for a merged outcome", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /decline/i })).toBeNull();
  });

  it("shows no buttons for a held card missing a runId", () => {
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7 } } as Message} />);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });
});
