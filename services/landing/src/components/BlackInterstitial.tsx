import { theme } from "../theme.js";

/** Full-screen black slide with huge type; the second line in blue. */
export function BlackInterstitial() {
  return (
    <section
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: theme.colors.accent }}
    >
      <h2 className="max-w-4xl text-4xl font-black leading-[1.08] tracking-tight text-white sm:text-6xl">
        Every agent your team uses.
        <br />
        One workspace.
      </h2>
      <p
        className="mt-6 text-4xl font-black tracking-tight sm:text-6xl"
        style={{ color: theme.colors.blueSoft }}
      >
        Always working.
      </p>
    </section>
  );
}
