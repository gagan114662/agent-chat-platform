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
  it("calls onOpenContext when the Context entry is clicked", () => {
    const onOpenContext = vi.fn();
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={onOpenContext} canCreateChannel={true} />);
    fireEvent.click(screen.getByRole("button", { name: /context/i }));
    expect(onOpenContext).toHaveBeenCalled();
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
  it("renders an Activity inbox affordance that lists mentions (#61)", () => {
    const onOpenInbox = vi.fn();
    render(<Sidebar channels={channels} threads={threads} dms={[]} principals={[]} repos={[]} activeThreadId={null} inbox={[{ threadId: "t1", title: "Demo thread", latestAt: "2024-01-01T00:00:00Z" }]} onOpenInbox={onOpenInbox} onSelectThread={() => {}} onCreateThread={() => {}} onCreateChannel={() => {}} onStartDm={() => {}} onOpenContext={() => {}} canCreateChannel={true} />);
    const activity = screen.getByRole("button", { name: /activity/i });
    expect(activity).toHaveTextContent("1");
    fireEvent.click(activity);
    expect(onOpenInbox).toHaveBeenCalled();
  });
});
