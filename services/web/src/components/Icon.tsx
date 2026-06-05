// Lightweight inline SVG icon set (stroke-based, 1.6px) — replaces emoji nav
// glyphs with crisp monochrome icons that inherit currentColor.
export type IconName =
  | "activity" | "context" | "memory" | "goals" | "agents" | "tasks"
  | "automations" | "billing" | "hash" | "search" | "settings" | "send"
  | "plus" | "logout" | "dm" | "sparkle";

const PATHS: Record<IconName, React.ReactNode> = {
  activity: <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
  context: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" /></>,
  memory: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />,
  goals: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
  agents: <><rect x="4" y="8" width="16" height="12" rx="2.5" /><path d="M12 8V4M9 3h6M9 14h.01M15 14h.01M9.5 17.5h5" /></>,
  tasks: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  automations: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
  billing: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></>,
  hash: <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  dm: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />,
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />,
};

export function Icon({ name, className = "", size = 16, strokeWidth = 1.6 }: {
  name: IconName; className?: string; size?: number; strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
