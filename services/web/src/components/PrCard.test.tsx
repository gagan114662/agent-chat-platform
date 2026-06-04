import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrCard } from "./PrCard.js";
import type { Message, ChangedFile, Checkpoint } from "../types.js";

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

describe("PrCard stacked badge", () => {
  it("shows a stacked-on badge when metadata.parentRunId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1", parentRunId: "r-parent" } } as Message} />);
    expect(screen.getByText(/stacked on/i)).toBeInTheDocument();
    expect(screen.getByText(/r-parent/)).toBeInTheDocument();
  });

  it("shows no stacked badge when parentRunId is absent", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.queryByText(/stacked on/i)).toBeNull();
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

describe("PrCard file explorer", () => {
  const files: ChangedFile[] = [
    { filename: "README.md", additions: 1, deletions: 0, status: "added", patch: "@@ -0,0 +1 @@\n+# Hi" },
  ];

  it("lists changed files as clickable buttons and opens a preview on click", async () => {
    const onLoadDiff = vi.fn(async () => files);
    const onOpenFile = vi.fn(async () => ({ content: "# Hi", encoding: "utf8" as const, size: 4 }));
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onLoadDiff={onLoadDiff} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole("button", { name: /view diff/i }));
    // The changed file appears in the explorer list (button) once the diff loads.
    const fileBtn = await screen.findByRole("button", { name: "README.md" });
    fireEvent.click(fileBtn);
    expect(onOpenFile).toHaveBeenCalledWith("run1", "README.md");
    // Markdown is rendered (heading), not raw text.
    await waitFor(() => {
      const hi = screen.getByText("Hi");
      expect(hi.tagName).toBe("H1");
    });
  });
});

describe("PrCard edit", () => {
  it("shows an Edit toggle when a runId is present", () => {
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("hides the Edit toggle when no runId is present", () => {
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7 } } as Message} />);
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
  });

  it("editing the title and Save calls onUpdatePr with the patch", () => {
    const onUpdatePr = vi.fn();
    render(<PrCard message={{ ...base, body: "🔶 held — PR #7", metadata: { outcome: "held_for_human", prNumber: 7, runId: "run1" } } as Message} onUpdatePr={onUpdatePr} />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: "new title" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onUpdatePr).toHaveBeenCalledWith("run1", { title: "new title" });
  });
});

describe("PrCard checkpoints", () => {
  const cps: Checkpoint[] = [
    { id: "cp1", orgId: "o1", runId: "run1", label: "agent push", branch: "agent/run1", commitSha: "deadbeefcafe", createdAt: new Date(0).toISOString() },
  ];

  it("shows a Checkpoints toggle when a runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} />);
    expect(screen.getByRole("button", { name: /checkpoints/i })).toBeInTheDocument();
  });

  it("hides the Checkpoints toggle when no runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7 } } as Message} />);
    expect(screen.queryByRole("button", { name: /checkpoints/i })).toBeNull();
  });

  it("clicking Checkpoints lazy-loads via onLoadCheckpoints(runId) and lists them", async () => {
    const onLoadCheckpoints = vi.fn(async () => cps);
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onLoadCheckpoints={onLoadCheckpoints} />);
    fireEvent.click(screen.getByRole("button", { name: /^checkpoints$/i }));
    expect(onLoadCheckpoints).toHaveBeenCalledWith("run1");
    await waitFor(() => expect(screen.getByText(/agent push/)).toBeInTheDocument());
    expect(screen.getByText(/deadbee/)).toBeInTheDocument();
  });

  it("clicking Restore calls onRestoreCheckpoint(runId, cpId)", async () => {
    const onLoadCheckpoints = vi.fn(async () => cps);
    const onRestoreCheckpoint = vi.fn();
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onLoadCheckpoints={onLoadCheckpoints} onRestoreCheckpoint={onRestoreCheckpoint} />);
    fireEvent.click(screen.getByRole("button", { name: /^checkpoints$/i }));
    const restoreBtn = await screen.findByRole("button", { name: /restore/i });
    fireEvent.click(restoreBtn);
    expect(onRestoreCheckpoint).toHaveBeenCalledWith("run1", "cp1");
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

describe("PrCard select run (#64)", () => {
  it("shows a Select button when a runId is present and onSelectRun is given", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onSelectRun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^select$/i })).toBeInTheDocument();
  });

  it("hides the Select button when no runId is present", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7 } } as Message} onSelectRun={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^select$/i })).toBeNull();
  });

  it("clicking Select calls onSelectRun with the runId", () => {
    const onSelectRun = vi.fn();
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1" } } as Message} onSelectRun={onSelectRun} />);
    fireEvent.click(screen.getByRole("button", { name: /^select$/i }));
    expect(onSelectRun).toHaveBeenCalledWith("run1");
  });

  it("shows a ✓ selected badge when metadata.selected is true", () => {
    render(<PrCard message={{ ...base, body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, runId: "run1", selected: true } } as Message} onSelectRun={vi.fn()} />);
    expect(screen.getByText(/selected/i)).toBeInTheDocument();
  });
});
