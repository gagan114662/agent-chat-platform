import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryPanel } from "./MemoryPanel.js";
import type { MemoryNode } from "../api.js";

const nodes: MemoryNode[] = [
  { id: "n1", orgId: "acme", kind: "decision", scope: "org", label: "Use Postgres", body: "chosen for jsonb", metadata: {}, version: 1, status: "active", createdAt: "2026-06-05T00:00:00Z" },
];

describe("MemoryPanel", () => {
  it("entering a query + search calls memoryRecall and renders results (#26)", async () => {
    const memoryRecall = vi.fn(async () => nodes);
    render(
      <MemoryPanel
        memoryRecall={memoryRecall}
        memoryConsolidate={vi.fn()}
        listMemoryNodes={vi.fn(async () => [] as MemoryNode[])}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/recall/i), { target: { value: "postgres" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
    await waitFor(() => expect(memoryRecall).toHaveBeenCalledWith("postgres"));
    expect(await screen.findByText("Use Postgres")).toBeInTheDocument();
    expect(screen.getByText(/chosen for jsonb/)).toBeInTheDocument();
  });

  it("Consolidate calls memoryConsolidate and shows the created count (#40)", async () => {
    const memoryConsolidate = vi.fn(async () => ({ created: 3, clusters: 2 }));
    render(
      <MemoryPanel
        memoryRecall={vi.fn(async () => [] as MemoryNode[])}
        memoryConsolidate={memoryConsolidate}
        listMemoryNodes={vi.fn(async () => [] as MemoryNode[])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /consolidate/i }));
    await waitFor(() => expect(memoryConsolidate).toHaveBeenCalled());
    expect(await screen.findByText(/3 created/)).toBeInTheDocument();
  });
});
