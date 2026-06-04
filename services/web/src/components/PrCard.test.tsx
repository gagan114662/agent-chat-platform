import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrCard } from "./PrCard.js";
import type { Message, ChangedFile } from "../types.js";

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

describe("PrCard view diff", () => {
  const files: ChangedFile[] = [
    { filename: "src/a.ts", additions: 2, deletions: 1, status: "modified", patch: "@@ -1,2 +1,3 @@\n context\n-removed\n+added line" },
  ];

  it("shows a View diff button when a runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.getByRole("button", { name: /view diff/i })).toBeInTheDocument();
  });

  it("hides the View diff button when no runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7 } } as Message} />);
    expect(screen.queryByRole("button", { name: /view diff/i })).toBeNull();
  });

  it("clicking View diff calls onLoadDiff(runId) and renders the returned diff", async () => {
    const onLoadDiff = vi.fn(async () => files);
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onLoadDiff={onLoadDiff} />);
    fireEvent.click(screen.getByRole("button", { name: /view diff/i }));
    expect(onLoadDiff).toHaveBeenCalledWith("run1");
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeInTheDocument());
    expect(screen.getByText("+added line")).toBeInTheDocument();
    expect(screen.getByText("-removed")).toBeInTheDocument();
  });
});

describe("PrCard sync comments", () => {
  it("shows a Sync comments button when a runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.getByRole("button", { name: /sync comments/i })).toBeInTheDocument();
  });

  it("hides the Sync comments button when no runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7 } } as Message} />);
    expect(screen.queryByRole("button", { name: /sync comments/i })).toBeNull();
  });

  it("clicking Sync comments calls onSyncComments with the runId", () => {
    const onSyncComments = vi.fn();
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onSyncComments={onSyncComments} />);
    fireEvent.click(screen.getByRole("button", { name: /sync comments/i }));
    expect(onSyncComments).toHaveBeenCalledWith("run1");
  });
});
