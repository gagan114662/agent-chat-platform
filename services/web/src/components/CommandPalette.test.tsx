import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette.js";
import type { Command } from "../lib/commands.js";

function makeCommands() {
  const runNew = vi.fn();
  const runSearch = vi.fn();
  const cmds: Command[] = [
    { id: "new", title: "New thread", keywords: "create", run: runNew },
    { id: "search", title: "Search messages…", keywords: "find", run: runSearch },
  ];
  return { cmds, runNew, runSearch };
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    const { cmds } = makeCommands();
    render(<CommandPalette open={false} commands={cmds} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders all commands when open", () => {
    const { cmds } = makeCommands();
    render(<CommandPalette open commands={cmds} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("New thread")).toBeInTheDocument();
    expect(screen.getByText("Search messages…")).toBeInTheDocument();
  });

  it("filters as you type", () => {
    const { cmds } = makeCommands();
    render(<CommandPalette open commands={cmds} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "search" } });
    expect(screen.getByText("Search messages…")).toBeInTheDocument();
    expect(screen.queryByText("New thread")).toBeNull();
  });

  it("runs the selected command on Enter then closes", () => {
    const { cmds, runNew } = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open commands={cmds} onClose={onClose} />);
    // first command (New thread) is selected by default
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(runNew).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves selection with ArrowDown and runs the new one on Enter", () => {
    const { cmds, runNew, runSearch } = makeCommands();
    render(<CommandPalette open commands={cmds} onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(runSearch).toHaveBeenCalledTimes(1);
    expect(runNew).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { cmds } = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open commands={cmds} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
