import { useMemo, useState } from "react";
import { filterCommands, type Command } from "../lib/commands.js";

// Maps a slash keyword to a registry command id. `/search`, `/new`, `/dm`, `/inbox`.
const SLASH_TO_ID: Record<string, string> = {
  search: "search",
  new: "new-thread",
  dm: "new-dm",
  inbox: "inbox",
};

export function Composer({ onSend, commands = [], onSlashSearch }: {
  onSend: (body: string) => void;
  // Shared command registry (#60) — drives the inline slash-command hint.
  commands?: Command[];
  // `/search <q>` passes its argument here (the registry's focusSearch ignores args).
  onSlashSearch?: (query: string) => void;
}) {
  const [text, setText] = useState("");

  const isSlash = text.startsWith("/");
  // Filter the registry by the text after the leading slash (first word).
  const slashQuery = isSlash ? text.slice(1).split(/\s+/)[0] : "";
  const matches = useMemo(
    () => (isSlash ? filterCommands(commands, slashQuery) : []),
    [isSlash, slashQuery, commands],
  );

  // Resolve the slash command the user is invoking (by leading keyword), if any.
  const resolveSlash = (): { cmd: Command; arg: string } | null => {
    if (!isSlash) return null;
    const word = text.slice(1).split(/\s+/)[0].toLowerCase();
    const arg = text.slice(1).slice(word.length).trim();
    const id = SLASH_TO_ID[word];
    if (!id) return null;
    const cmd = commands.find((c) => c.id === id);
    return cmd ? { cmd, arg } : null;
  };

  const submit = () => {
    // Slash command: run it instead of posting a message.
    const slash = resolveSlash();
    if (slash) {
      if (slash.cmd.id === "search" && onSlashSearch) onSlashSearch(slash.arg);
      else slash.cmd.run();
      setText("");
      return;
    }
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText("");
  };

  return (
    <div className="border-t border-[#e7e7f0] bg-white p-3">
      {isSlash && matches.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-lg border border-[#e7e7f0] text-sm" aria-label="slash commands">
          {matches.map((c) => (
            <li key={c.id} className="border-b border-[#e7e7f0] px-3 py-1.5 text-neutral-700 last:border-0">
              {c.title}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message #general — try @coder <intent> or /search"
          rows={1}
          className="min-h-[40px] flex-1 resize-none rounded-lg border border-[#e7e7f0] px-3 py-2 text-sm focus:border-neutral-800 focus:outline-none"
        />
        <button
          onClick={submit}
          className="rounded-lg bg-[#15151f] px-4 py-2 text-sm font-medium text-white hover:bg-black"
        >
          Send
        </button>
      </div>
    </div>
  );
}
