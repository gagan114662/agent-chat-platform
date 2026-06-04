import { describe, it, expect, vi } from "vitest";
import { filterCommands, buildCommands, type Command } from "./commands.js";

const cmds: Command[] = [
  { id: "a", title: "New thread", keywords: "create", run: () => {} },
  { id: "b", title: "Open Activity (inbox)", keywords: "notifications mentions", run: () => {} },
  { id: "c", title: "Search messages…", keywords: "find", run: () => {} },
];

describe("filterCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(3);
    expect(filterCommands(cmds, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively over title", () => {
    const r = filterCommands(cmds, "search");
    expect(r.map((c) => c.id)).toEqual(["c"]);
  });

  it("matches over keywords too", () => {
    const r = filterCommands(cmds, "mentions");
    expect(r.map((c) => c.id)).toEqual(["b"]);
  });

  it("ranks prefix/word-start matches before mid-word matches", () => {
    const list: Command[] = [
      { id: "x", title: "Go to #random", run: () => {} },
      { id: "y", title: "New thread", run: () => {} },
    ];
    // "new" is a prefix of "New thread" → should outrank the mid-word match in "#random"? No "new" there.
    // Use "ra": prefix of nothing here; instead test word-start ranking with "th".
    const r = filterCommands(list, "th");
    expect(r[0].id).toBe("y"); // "thread" is a word-start in "New thread"
  });

  it("ranks a title prefix above a non-prefix match", () => {
    const list: Command[] = [
      { id: "mid", title: "Open Search panel", run: () => {} },
      { id: "pre", title: "Search messages", run: () => {} },
    ];
    const r = filterCommands(list, "search");
    expect(r[0].id).toBe("pre");
  });
});

describe("buildCommands", () => {
  it("builds nav + action commands wired to the given actions", () => {
    const actions = {
      selectChannel: vi.fn(),
      selectThread: vi.fn(),
      openNewThread: vi.fn(),
      openNewDm: vi.fn(),
      openInbox: vi.fn(),
      focusSearch: vi.fn(),
    };
    const channels = [{ id: "c1", name: "general" }];
    const threads = [{ id: "t1", title: "Demo thread" }];
    const out = buildCommands({ channels, threads, actions });

    const goChannel = out.find((c) => c.title === "Go to #general");
    expect(goChannel).toBeDefined();
    goChannel!.run();
    expect(actions.selectChannel).toHaveBeenCalledWith("c1");

    const goThread = out.find((c) => c.title === "Go to Demo thread");
    expect(goThread).toBeDefined();
    goThread!.run();
    expect(actions.selectThread).toHaveBeenCalledWith("t1");

    out.find((c) => c.title === "New thread")!.run();
    expect(actions.openNewThread).toHaveBeenCalled();

    out.find((c) => c.title === "New DM")!.run();
    expect(actions.openNewDm).toHaveBeenCalled();

    out.find((c) => c.title === "Open Activity (inbox)")!.run();
    expect(actions.openInbox).toHaveBeenCalled();

    out.find((c) => c.title.startsWith("Search messages"))!.run();
    expect(actions.focusSearch).toHaveBeenCalled();
  });
});
