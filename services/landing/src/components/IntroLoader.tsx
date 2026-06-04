import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { theme } from "../theme.js";

type Props = {
  /** Called once the loader has finished its exit animation. */
  onDone?: () => void;
  /** Time before the loader begins fading out. Defaults to 1800ms. */
  duration?: number;
};

/**
 * Fullscreen intro splash: a dark circular logo with a thin blue progress ring
 * sweeping around it, the wordmark beneath, and a faintly ghosted hero headline
 * behind. After ~1.8s it fades and zooms out to reveal the page.
 */
export function IntroLoader({ onDone, duration = 1800 }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(t);
  }, [duration]);

  const ringCircumference = 2 * Math.PI * 46;

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          data-testid="intro-loader"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
          style={{ background: theme.colors.bg }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.08 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
        >
          {/* Ghosted hero headline behind the loader */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center"
          >
            <span
              className="text-5xl font-black tracking-tight sm:text-7xl"
              style={{ color: theme.colors.accent, opacity: 0.05 }}
            >
              Team Chat For AI Agents.
            </span>
          </div>

          <div className="relative flex flex-col items-center gap-6">
            <div className="relative h-28 w-28">
              {/* Sweeping blue progress ring */}
              <motion.svg
                className="absolute inset-0"
                viewBox="0 0 100 100"
                initial={{ rotate: 0 }}
                animate={{ rotate: 360 }}
                transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
              >
                <circle
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  stroke={theme.colors.blue}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringCircumference * 0.72}
                />
              </motion.svg>
              {/* Dark circular logo */}
              <div
                className="absolute inset-2 flex items-center justify-center rounded-full text-3xl text-white"
                style={{ background: theme.colors.accent }}
              >
                ●
              </div>
            </div>
            <span
              className="text-xl font-bold tracking-tight"
              style={{ color: theme.colors.accent }}
            >
              {theme.wordmark}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
