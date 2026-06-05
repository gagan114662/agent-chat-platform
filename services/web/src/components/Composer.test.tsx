import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Composer } from "./Composer.js";
import type { Command } from "../lib/commands.js";

describe("Composer", () => {
  it("calls onSend with the typed text and clears the field (on success)", async () => {
    const onSend = vi.fn(async () => {});
    render(<Composer onSend={onSend} />);
    const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "@coder fix it" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("@coder fix it");
    // Clears only after the send resolves (#123 — async, no longer synchronous).
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("does not send empty/whitespace messages", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  function slashCommands() {
    const runSearch = vi.fn();
    const runNew = vi.fn();
    const commands: Command[] = [
      { id: "search", title: "Search messages…", keywords: "find search", run: runSearch },
      { id: "new-thread", title: "New thread", keywords: "create", run: runNew },
      { id: "inbox", title: "Open Activity (inbox)", keywords: "notifications", run: vi.fn() },
      { id: "new-dm", title: "New DM", keywords: "dm", run: vi.fn() },
    ];
    return { commands, runSearch, runNew };
  }

  it("shows matching slash commands when input starts with /", () => {
    const { commands } = slashCommands();
    render(<Composer onSend={vi.fn()} commands={commands} />);
    fireEvent.change(screen.getByPlaceholderText(/message/i), { target: { value: "/sea" } });
    expect(screen.getByText("Search messages…")).toBeInTheDocument();
    expect(screen.queryByText("New thread")).toBeNull();
  });

  it("runs the slash command on Enter and does NOT post a message", () => {
    const onSend = vi.fn();
    const onSlashSearch = vi.fn();
    const { commands, runNew } = slashCommands();
    const input = (() => {
      render(<Composer onSend={onSend} commands={commands} onSlashSearch={onSlashSearch} />);
      return screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    })();
    fireEvent.change(input, { target: { value: "/new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runNew).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("passes the argument for /search <q>", () => {
    const onSend = vi.fn();
    const onSlashSearch = vi.fn();
    const { commands } = slashCommands();
    render(<Composer onSend={onSend} commands={commands} onSlashSearch={onSlashSearch} />);
    const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "/search login bug" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSlashSearch).toHaveBeenCalledWith("login bug");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("still sends a normal message with an @mention", async () => {
    const onSend = vi.fn(async () => {});
    const { commands } = slashCommands();
    render(<Composer onSend={onSend} commands={commands} />);
    const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello @coder" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hello @coder");
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("offers @mention autocomplete and inserts the picked handle (#108)", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} mentionables={[{ kind: "agent", name: "coder" }, { kind: "human", name: "alice" }]} />);
    const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "@co" } });
    const opt = screen.getByText("@coder");
    expect(opt).toBeInTheDocument();
    fireEvent.click(opt);
    expect(input.value).toBe("@coder ");
  });


  it("keeps the text and surfaces an error when send fails, clears on success (#123)", async () => {
    const fail = vi.fn(async () => { throw new Error("network down"); });
    render(<Composer onSend={fail} />);
    const input = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/network down/i);
    expect(input.value).toBe("hello world"); // NOT cleared on failure

    const ok = vi.fn(async () => {});
    cleanup();
    render(<Composer onSend={ok} />);
    const input2 = screen.getByPlaceholderText(/message/i) as HTMLTextAreaElement;
    fireEvent.change(input2, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(ok).toHaveBeenCalledWith("second"));
    await waitFor(() => expect(input2.value).toBe("")); // cleared on success
  });

});
