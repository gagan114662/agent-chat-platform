import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AgentsPanel } from "./AgentsPanel.js";
import type { Agent } from "../api.js";

const agents: Agent[] = [
  { id: "a1", orgId: "acme", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {}, shared: false, avatarUrl: null, visibility: "public" },
];

describe("AgentsPanel", () => {
  it("renders agents from the fetch (#91)", async () => {
    const listAgents = vi.fn(async () => agents);
    render(<AgentsPanel listAgents={listAgents} setAgentProfile={vi.fn()} />);
    expect(await screen.findByText("coder")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(listAgents).toHaveBeenCalled();
  });

  it("changing visibility + save calls setAgentProfile (#91)", async () => {
    const listAgents = vi.fn(async () => agents);
    const setAgentProfile = vi.fn(async (_id: string, patch: { visibility?: "public" | "private" }) => ({ ...agents[0], visibility: patch.visibility ?? "public" }));
    render(<AgentsPanel listAgents={listAgents} setAgentProfile={setAgentProfile} />);
    await screen.findByText("coder");
    fireEvent.change(screen.getByLabelText(/visibility for coder/i), { target: { value: "private" } });
    fireEvent.click(screen.getByRole("button", { name: /save coder/i }));
    await waitFor(() => expect(setAgentProfile).toHaveBeenCalledWith("a1", { visibility: "private", avatarUrl: null }));
  });
});
