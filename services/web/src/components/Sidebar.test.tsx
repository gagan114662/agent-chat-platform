import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar.js";
import type { Channel, Thread } from "../types.js";

const channels: Channel[] = [{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }];
const threads: Thread[] = [
  { id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1" },
  { id: "t2", orgId: "o1", channelId: "c1", title: "Second thread", repoId: null },
];

describe("Sidebar", () => {
  it("renders channels and their threads", () => {
    render(<Sidebar channels={channels} threads={threads} repos={[]} activeThreadId="t1" onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} />);
    expect(screen.getByText("# general")).toBeInTheDocument();
    expect(screen.getByText("Demo thread")).toBeInTheDocument();
    expect(screen.getByText("Second thread")).toBeInTheDocument();
  });
  it("calls onSelectThread when a thread is clicked", () => {
    const onSelect = vi.fn();
    render(<Sidebar channels={channels} threads={threads} repos={[]} activeThreadId="t1" onSelectThread={onSelect} onCreateThread={() => {}} onCreateChannel={() => {}} />);
    fireEvent.click(screen.getByText("Second thread"));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });
  it("calls onCreateChannel when a channel name is entered", () => {
    const onCreateChannel = vi.fn();
    render(<Sidebar channels={channels} threads={threads} repos={[]} activeThreadId="t1" onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={onCreateChannel} />);
    fireEvent.change(screen.getByPlaceholderText(/new channel/i), { target: { value: "random" } });
    fireEvent.click(screen.getByRole("button", { name: /create channel/i }));
    expect(onCreateChannel).toHaveBeenCalledWith("random");
  });
});
