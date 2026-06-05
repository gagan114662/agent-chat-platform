import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceRail } from "./WorkspaceRail.js";

describe("WorkspaceRail", () => {
  it("renders the section icons and routes clicks to their handlers", () => {
    const onContext = vi.fn();
    render(<WorkspaceRail onSelect={{ context: onContext }} />);
    fireEvent.click(screen.getByRole("button", { name: /context/i }));
    expect(onContext).toHaveBeenCalled();
  });

  it("shows the inbox count on the Activity icon and fires onSelect.activity", () => {
    const onActivity = vi.fn();
    render(<WorkspaceRail inboxCount={3} onSelect={{ activity: onActivity }} />);
    const activity = screen.getByRole("button", { name: /activity/i });
    expect(activity).toHaveTextContent("3");
    fireEvent.click(activity);
    expect(onActivity).toHaveBeenCalled();
  });

  it("marks the active section with aria-current", () => {
    render(<WorkspaceRail active="tasks" onSelect={{}} />);
    expect(screen.getByRole("button", { name: /tasks/i })).toHaveAttribute("aria-current", "page");
  });
});
