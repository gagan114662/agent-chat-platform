import { useState } from "react";
import type { SearchResult } from "../types.js";

export function SearchBar({ onSearch, onSelect }: {
  onSearch: (q: string) => Promise<SearchResult[]>;
  onSelect: (threadId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  const run = async () => {
    const r = await onSearch(q);
    setResults(r);
    setOpen(true);
  };

  return (
    <div className="relative">
      <input
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
