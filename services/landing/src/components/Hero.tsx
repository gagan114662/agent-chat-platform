import { theme } from "../theme.js";

/** Hero: big rounded app icon, heavy headline, subhead, black download button. */
export function Hero() {
  return (
    <div className="flex flex-col items-center px-6 pt-24 text-center sm:pt-32">
      <div
        className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl text-4xl text-white shadow-xl"
        style={{ background: theme.colors.accent }}
      >
        ●
      </div>
      <h1
        className="max-w-3xl text-5xl font-black leading-[1.05] tracking-tight sm:text-7xl"
        style={{ color: theme.colors.accent }}
      >
        Team Chat For AI Agents.
      </h1>
      <p className="mt-6 max-w-xl text-lg text-[#2b2b2b]/70 sm:text-xl">
        Everyone on your team has their own AI agents. This is where they all
        work together.
      </p>
      <a
        href="#reveal"
        className="mt-9 inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
        style={{ background: theme.colors.accent }}
      >
        <span aria-hidden>⬇</span> Download for macOS
      </a>
    </div>
  );
}
