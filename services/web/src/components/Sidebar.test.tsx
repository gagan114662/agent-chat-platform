import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar.js";
import type { Channel, Thread } from "../types.js";

const channels: Channel[] = [{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }];
const threads: Thread[] = [
  { id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1", kind: "channel" },
  { id: "t2", orgId: "o1", channelId: "c1", title: "Second thread", repoId: null, kind: "channel" },
];

describe("Sidebar", () => {
  it("renders channels and their threads", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId="t1" onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    expect(screen.getByText("# general")).toBeInTheDocument();
    expect(screen.getByText("Demo thread")).toBeInTheDocument();
    expect(screen.getByText("Second thread")).toBeInTheDocument();
  });
  it("calls onSelectThread when a thread is clicked", () => {
    const onSelect = vi.fn();
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId="t1" onSelectThread={onSelect} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    fireEvent.click(screen.getByText("Second thread"));
    expect(onSelect).toHaveBeenCalledWith("t2");
  });
  it("calls onCreateChannel when a channel name is entered", () => {
    const onCreateChannel = vi.fn();
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId="t1" onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={onCreateChannel} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    fireEvent.change(screen.getByPlaceholderText(/new channel/i), { target: { value: "random" } });
    fireEvent.click(screen.getByRole("button", { name: /create channel/i }));
    expect(onCreateChannel).toHaveBeenCalledWith("random");
  });
  it("renders the Direct Messages section with dm threads", () => {
    const dms = [{ id: "dm1", orgId: "o1", channelId: null, title: "Coder", repoId: null, kind: "dm" as const }];
    render(<Sidebar channels={channels} threads={threads} dms={dms} principals={[]} repos={[]} activeThreadId={null} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    expect(screen.getByText("Direct Messages")).toBeInTheDocument();
    expect(screen.getByText("Coder")).toBeInTheDocument();
  });
  it("hides channel creation for non-admins", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={false} />);
    expect(screen.queryByPlaceholderText(/new channel/i)).not.toBeInTheDocument();
  });
  it("shows an unread badge for a thread with unread > 0, and none otherwise (#61)", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} unreads={{ t1: 2 }} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    const t1Badge = screen.getByLabelText("2 unread in Demo thread");
    expect(t1Badge).toHaveTextContent("2");
    expect(screen.queryByLabelText(/unread in Second thread/)).not.toBeInTheDocument();
  });
  it("shows the real authenticated identity instead of the dev stub (#68)", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} identity={{ userId: "alice", orgId: "acme", role: "admin" }} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    const id = screen.getByText(/alice/);
    expect(id).toHaveTextContent("alice");
    expect(id).toHaveTextContent("acme");
    expect(id).toHaveTextContent("admin");
    expect(screen.queryByText(/dev stub/)).not.toBeInTheDocument();
    expect(screen.queryByText(/m1 · org o1/)).not.toBeInTheDocument();
  });
  it("shows a dev badge when no real identity is present (#68)", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    expect(screen.getByText(/dev/i)).toBeInTheDocument();
  });
  it("filters threads by the channel search box", () => {
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    fireEvent.change(screen.getByPlaceholderText(/search channels/i), { target: { value: "Second" } });
    expect(screen.getByText("Second thread")).toBeInTheDocument();
    expect(screen.queryByText("Demo thread")).not.toBeInTheDocument();
  });
});
