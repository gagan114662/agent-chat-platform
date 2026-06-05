import { useMemo, useState } from "react";
import { filterCommands, type Command } from "../lib/commands.js";
import { Icon } from "./Icon.js";

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

  const empty = text.trim().length === 0;
  return (
    <div className="bg-surface px-4 pb-4 pt-2">
      {isSlash && matches.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-xl border border-line bg-elevated text-sm shadow-lg shadow-black/30" aria-label="slash commands">
          {matches.map((c) => (
            <li key={c.id} className="flex items-center gap-2 border-b border-line-soft px-3 py-2 text-ink-2 last:border-0 hover:bg-elevated-2">
              <Icon name="sparkle" size={13} className="text-ink-3" />
              {c.title}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated px-3 py-2.5 transition-colors focus-within:border-accent/70">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message #general — try @coder <intent> or /search"
          rows={1}
          className="max-h-40 min-h-[24px] w-full resize-none bg-transparent text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-3">
            <span className="text-accent">@</span>agent to dispatch · <span className="text-ink-2">/</span> for commands
          </span>
          <button
            onClick={submit}
            disabled={empty}
            aria-label="Send"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-elevated-2 disabled:text-ink-3"
          >
            <Icon name="send" size={14} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}
