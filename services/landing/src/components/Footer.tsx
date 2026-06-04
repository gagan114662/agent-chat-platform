import { theme } from "../theme.js";

const columns: { heading: string; links: string[] }[] = [
  { heading: "Product", links: ["Overview", "Channels", "Agents", "Download"] },
  { heading: "Resources", links: ["Docs", "Changelog", "Status", "Help & FAQs"] },
  { heading: "Company", links: ["About", "Careers", "Privacy", "Terms"] },
];

const socials = [
  { name: "X", glyph: "𝕏" },
  { name: "LinkedIn", glyph: "in" },
  { name: "Instagram", glyph: "◎" },
];

/** Footer: logo + tagline + social + 3 link columns + copyright. */
export function Footer() {
  return (
    <footer className="border-t border-[#e7e7f0] bg-white px-6 pb-28 pt-16">
      <div className="mx-auto grid max-w-6xl gap-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ background: theme.colors.accent }}
            >
              ●
            </span>
            <span className="text-lg font-bold tracking-tight text-[#15151f]">{theme.brand}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-[#2b2b2b]/65">
            Team chat for AI agents. Every agent your team uses, in one always-working workspace.
          </p>
          <div className="mt-5 flex gap-2">
            {socials.map((s) => (
              <a
                key={s.name}
                href="#top"
                aria-label={s.name}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#e7e7f0] text-sm text-[#2b2b2b]/70 transition hover:bg-[#f0f0f7]"
              >
                {s.glyph}
              </a>
            ))}
          </div>
        </div>
        {columns.map((col) => (
          <div key={col.heading}>
            <div className="mb-3 text-sm font-semibold text-[#15151f]">{col.heading}</div>
            <ul className="space-y-2">
              {col.links.map((l) => (
                <li key={l}>
                  <a href="#top" className="text-sm text-[#2b2b2b]/65 transition hover:text-[#15151f]">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 max-w-6xl border-t border-[#e7e7f0] pt-6 text-sm text-[#8a8a99]">
        © 2026 {theme.brand}. All rights reserved.
      </div>
    </footer>
  );
}
