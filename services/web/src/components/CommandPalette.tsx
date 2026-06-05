import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands.js";

// ⌘K command palette (#60): overlay + filter input + result list. Keyboard:
// ↑/↓ moves selection, Enter runs the selected command, Esc closes.
export function CommandPalette({ open, commands, onClose }: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset query/selection and focus the input each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the selection in range as the result list shrinks/grows.
  useEffect(() => { setSelected((s) => Math.min(s, Math.max(0, results.length - 1))); }, [results.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[selected];
      if (cmd) { cmd.run(); onClose(); }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search…"
          aria-label="Command"
          className="w-full border-b border-line px-4 py-3 text-sm focus:outline-none"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-3">No commands</li>
          ) : (
            results.map((cmd, i) => (
              <li key={cmd.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => { cmd.run(); onClose(); }}
                  aria-selected={i === selected}
                  className={`block w-full px-4 py-2 text-left text-sm ${i === selected ? "bg-accent text-white" : "text-ink-2 hover:bg-elevated-2"}`}
                >
                  {cmd.title}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
