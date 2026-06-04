import { theme } from "../theme.js";

type DockItem = {
  label: string;
  href: string;
  glyph: string;
  highlight?: boolean;
};

const items: DockItem[] = [
  { label: "Home", href: "#top", glyph: "⌂" },
  { label: "Product", href: "#reveal", glyph: "◳" },
  { label: "Features", href: "#features", glyph: "◧" },
  { label: "FAQ", href: "#faq", glyph: "?" },
  { label: "Contact", href: "#contact", glyph: "✉" },
];

/**
 * Persistent macOS-style dock floating at the bottom: a brand icon, section
 * icons, and a highlighted download tile.
 */
export function Dock() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="flex items-center gap-1.5 rounded-2xl border border-white/40 bg-white/70 px-2 py-1.5 shadow-lg shadow-black/5 backdrop-blur-xl">
        {/* Brand icon */}
        <a
          href="#top"
          aria-label={`${theme.brand} home`}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-base text-white transition hover:scale-105"
          style={{ background: theme.colors.accent }}
        >
          ●
        </a>
        <span className="mx-0.5 h-6 w-px bg-black/10" />
        {items.map((it) => (
          <a
            key={it.label}
            href={it.href}
            aria-label={it.label}
            title={it.label}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-[#2b2b2b]/70 transition hover:scale-105 hover:bg-black/5 hover:text-[#15151f]"
          >
            {it.glyph}
          </a>
        ))}
        <span className="mx-0.5 h-6 w-px bg-black/10" />
        {/* Highlighted download tile */}
        <a
          href="#top"
          className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white transition hover:scale-105"
          style={{ background: theme.colors.blue }}
        >
          <span aria-hidden>⬇</span>
          <span className="hidden sm:inline">Download</span>
        </a>
      </div>
    </nav>
  );
}
