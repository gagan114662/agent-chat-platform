import { useState } from "react";
import { theme } from "../theme.js";

/**
 * Slim blue top bar with a short product announcement and an arrow.
 * Dismissible via the X button. Placeholder copy — no fabricated claims.
 */
export function FundingBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div
      className="relative z-40 flex items-center justify-center gap-2 px-10 py-2 text-center text-sm font-medium text-white"
      style={{ background: theme.colors.blue }}
    >
      <a href="#contact" className="inline-flex items-center gap-2 hover:underline">
        <span className="hidden sm:inline">Announcement —</span>
        <span>{theme.brand} is now open for early-access teams</span>
        <span aria-hidden>→</span>
      </a>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={() => setOpen(false)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/80 transition hover:bg-white/20 hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
