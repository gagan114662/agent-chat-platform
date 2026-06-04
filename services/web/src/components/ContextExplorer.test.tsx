import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextExplorer } from "./ContextExplorer.js";
import type { MemoryGraph } from "../types.js";

const graph: MemoryGraph = {
  nodes: [
    { id: "n1", orgId: "o1", kind: "decision", scope: "org", label: "merged PR #7", body: "fix login", metadata: {}, createdAt: new Date(0).toISOString() },
    { id: "n2", orgId: "o1", kind: "identity", scope: "org", label: "coder", body: "", metadata: {}, createdAt: new Date(0).toISOString() },
  ],
  edges: [{ id: "e1", fromId: "n1", toId: "n2", relation: "authored_by" }],
};

describe("ContextExplorer", () => {
  it("shows stats and renders the nodes", () => {
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={() => {}} kind={undefined} onKindChange={() => {}} loading={false} />);
    expect(screen.getByText(/2 memories/)).toBeInTheDocument();
    expect(screen.getByText(/1 edges/)).toBeInTheDocument();
    expect(screen.getByText("merged PR #7")).toBeInTheDocument();
  });
  it("calls onScopeChange when a scope chip is clicked", () => {
    const onScopeChange = vi.fn();
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={onScopeChange} kind={undefined} onKindChange={() => {}} loading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(onScopeChange).toHaveBeenCalledWith("team");
  });
  it("selecting a node shows its detail", () => {
    render(<ContextExplorer graph={graph} stats={{ nodes: 2, edges: 1 }} scope="org" onScopeChange={() => {}} kind={undefined} onKindChange={() => {}} loading={false} />);
    fireEvent.click(screen.getByText("merged PR #7"));
    expect(screen.getByText("fix login")).toBeInTheDocument(); // body shown on select
  });
});
