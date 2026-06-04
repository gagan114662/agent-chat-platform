import type { ReactNode } from "react";
import { theme } from "../theme.js";

type Props = {
  children: ReactNode;
  title?: string;
  className?: string;
};

/**
 * Dark macOS-style window chrome (traffic lights + title bar) wrapping an app
 * view. Reused by ScrollAppReveal and FeatureCards.
 */
export function AppWindow({ children, title = "Convene", className = "" }: Props) {
  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border border-black/40 shadow-2xl ${className}`}
      style={{ background: theme.colors.accent }}
    >
      {/* Title bar */}
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-white/5 px-4">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-xs font-medium text-white/50">{title}</span>
      </div>
      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
