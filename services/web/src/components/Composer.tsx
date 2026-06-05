import { useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands.js";
import { Icon, type IconName } from "./Icon.js";

// Maps a slash keyword to a registry command id. `/search`, `/new`, `/dm`, `/inbox`.
const SLASH_TO_ID: Record<string, string> = {
  search: "search",
  new: "new-thread",
  dm: "new-dm",
  inbox: "inbox",
};

export interface Mentionable { kind: "human" | "agent"; name: string; }

export function Composer({ onSend, commands = [], onSlashSearch, mentionables = [] }: {
  onSend: (body: string) => void;
  // Shared command registry (#60) — drives the inline slash-command hint.
  commands?: Command[];
  // `/search <q>` passes its argument here (the registry's focusSearch ignores args).
  onSlashSearch?: (query: string) => void;
  // #108: workspace agents + humans for @mention autocomplete.
  mentionables?: Mentionable[];
}) {
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Candidates for the @mention popup: prefix-match on the partial handle, agents first.
  const mentionMatches = mention
    ? mentionables
        .filter((m) => m.name.toLowerCase().startsWith(mention.q.toLowerCase()))
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1))
        .slice(0, 6)
    : [];

  // Track the @token being typed at the caret so the popup can offer completions.
  const onChange = (v: string, caret: number) => {
    setText(v);
    const m = /(?:^|\s)@(\w*)$/.exec(v.slice(0, caret));
    setMention(m ? { q: m[1], at: caret } : null);
  };

  // Replace the partial "@q" before the caret with the picked "@name ".
  const pickMention = (name: string) => {
    if (!mention) return;
    const before = text.slice(0, mention.at).replace(/@(\w*)$/, `@${name} `);
    const after = text.slice(mention.at);
    const nt = before + after;
    setText(nt);
    setMention(null);
    requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(before.length, before.length); });
  };

  // Apply a markdown transform to the current selection, then restore focus/caret.
  const edit = (fn: (t: string, s: number, e: number) => { text: string; selStart: number; selEnd: number }) => {
    const ta = taRef.current;
    const s = ta ? ta.selectionStart : text.length;
    const e = ta ? ta.selectionEnd : text.length;
    const r = fn(text, s, e);
    setText(r.text);
    requestAnimationFrame(() => { ta?.focus(); ta?.setSelectionRange(r.selStart, r.selEnd); });
  };
  // Wrap the selection in `before`/`after` (e.g. ** ** for bold).
  const wrap = (before: string, after = before) => edit((t, s, e) => {
    const sel = t.slice(s, e);
    const text = t.slice(0, s) + before + sel + after + t.slice(e);
    return { text, selStart: s + before.length, selEnd: s + before.length + sel.length };
  });
  // Prefix the selection's first line (e.g. "> " for quote, "- " for list).
  const prefixLine = (p: string) => edit((t, s, e) => {
    const ls = t.lastIndexOf("\n", s - 1) + 1;
    const text = t.slice(0, ls) + p + t.slice(ls);
    return { text, selStart: s + p.length, selEnd: e + p.length };
  });
  const tools: { key: string; label: string; glyph?: string; icon?: IconName; run: () => void }[] = [
    { key: "b", label: "Bold", glyph: "B", run: () => wrap("**") },
    { key: "i", label: "Italic", glyph: "I", run: () => wrap("*") },
    { key: "s", label: "Strikethrough", glyph: "S", run: () => wrap("~~") },
    { key: "code", label: "Code", icon: "code", run: () => wrap("`") },
    { key: "link", label: "Link", icon: "link", run: () => wrap("[", "](https://)") },
    { key: "quote", label: "Quote", icon: "quote", run: () => prefixLine("> ") },
    { key: "list", label: "List", icon: "list", run: () => prefixLine("- ") },
  ];

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
      {mention && mentionMatches.length > 0 && (
        <ul className="mb-2 overflow-hidden rounded-xl border border-line bg-elevated text-sm shadow-lg shadow-black/30" aria-label="mention suggestions">
          {mentionMatches.map((m) => (
            <li key={`${m.kind}:${m.name}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(m.name)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink-2 hover:bg-elevated-2 hover:text-ink"
              >
                <Icon name={m.kind === "agent" ? "agents" : "dm"} size={13} className="text-ink-3" />
                <span className="font-medium text-ink">@{m.name}</span>
                <span className="text-[11px] text-ink-3">{m.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-elevated px-3 py-2 transition-colors focus-within:border-accent/70">
        <div className="flex items-center gap-0.5 border-b border-line-soft pb-1.5">
          {tools.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t.run}
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-elevated-2 hover:text-ink"
            >
              {t.glyph
                ? <span className={`text-[13px] ${t.key === "b" ? "font-bold" : t.key === "i" ? "italic" : t.key === "s" ? "line-through" : ""}`}>{t.glyph}</span>
                : <Icon name={t.icon!} size={15} />}
            </button>
          ))}
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            // When the @mention popup is open, Enter/Tab completes the top match.
            if (mention && mentionMatches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault(); pickMention(mentionMatches[0].name); return;
            }
            if (e.key === "Escape" && mention) { setMention(null); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
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
