import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageItem } from "./MessageItem.js";
import type { Message } from "../types.js";

const base = { id: "x", orgId: "o1", threadId: "t1", authorId: "a", metadata: {}, createdAt: new Date(0).toISOString() };

describe("MessageItem", () => {
  it("renders a human chat message body", () => {
    render(<MessageItem message={{ ...base, authorKind: "human", kind: "chat", body: "fix the login bug" } as Message} />);
    expect(screen.getByText("fix the login bug")).toBeInTheDocument();
  });

  it("renders a system step as muted text", () => {
    render(<MessageItem message={{ ...base, authorKind: "agent", kind: "system", body: "🧪 sandbox started" } as Message} />);
    expect(screen.getByText("🧪 sandbox started")).toBeInTheDocument();
  });

  it("renders a pr_card with the PR link and outcome", () => {
    render(<MessageItem message={{ ...base, authorKind: "agent", kind: "pr_card", body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, prUrl: "https://gh/pr/7" } } as Message} />);
    const link = screen.getByRole("link", { name: "PR #7" });
    expect(link).toHaveAttribute("href", "https://gh/pr/7");
    expect(screen.getByText("merged")).toBeInTheDocument();
  });

  it("does NOT render a non-https prUrl as a link (XSS hardening, #36)", () => {
    render(<MessageItem message={{ ...base, authorKind: "agent", kind: "pr_card", body: "✅ merged PR #7", metadata: { outcome: "merged", prNumber: 7, prUrl: "javascript:alert(1)" } } as Message} />);
    // no anchor — the PR number is shown as plain text instead
    expect(screen.queryByRole("link", { name: "PR #7" })).toBeNull();
    expect(screen.getByText("PR #7")).toBeInTheDocument();
  });
});
