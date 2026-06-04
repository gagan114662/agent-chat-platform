import { useEffect, useState, type RefObject } from "react";
import type { SearchResult } from "../types.js";

export function SearchBar({ onSearch, onSelect, inputRef, initialQuery }: {
  onSearch: (q: string) => Promise<SearchResult[]>;
  onSelect: (threadId: string) => void;
  // Optional ref so the command registry's "focusSearch" action can focus this input.
  inputRef?: RefObject<HTMLInputElement>;
  // Optional initial query (used by the `/search <q>` slash command) — runs once on mount.
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  const run = async (query = q) => {
    const r = await onSearch(query);
    setResults(r);
    setOpen(true);
  };

  // When given an initialQuery, run it immediately so `/search foo` shows results.
  useEffect(() => {
    if (initialQuery) { setQ(initialQuery); run(initialQuery); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        placeholder="Search messages…"
        className="w-72 rounded-lg border border-[#e7e7f0] px-3 py-1.5 text-sm focus:border-neutral-800 focus:outline-none"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-96 rounded-xl border border-[#e7e7f0] bg-white shadow-lg">
          {results.length === 0
            ? <div className="px-3 py-2 text-sm text-neutral-400">No matches</div>
            : results.map((r) => (
                <button
                  key={r.messageId}
                  onClick={() => { onSelect(r.threadId); setOpen(false); }}
                  className="block w-full border-b border-[#e7e7f0] px-3 py-2 text-left last:border-0 hover:bg-neutral-50"
                >
                  <div className="text-xs font-medium text-neutral-800">{r.threadTitle}</div>
                  <div className="truncate text-sm text-neutral-700">{r.body}</div>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
