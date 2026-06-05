import { Icon, type IconName } from "./Icon.js";

export type RailView = "activity" | "context" | "memory" | "goals" | "agents" | "tasks" | "automations" | "billing" | "businesses";

// Slack-style far-left workspace rail: the logo plus icon-only navigation into the
// app's section views. The channel/thread list lives in the adjacent Sidebar.
export function WorkspaceRail({ active, inboxCount = 0, onSelect, theme = "dark", onToggleTheme }: {
  active?: string;
  inboxCount?: number;
  onSelect: Partial<Record<RailView, () => void>>;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
}) {
  const items: { view: RailView; icon: IconName; label: string; badge?: number }[] = [
    { view: "activity", icon: "activity", label: "Activity", badge: inboxCount },
    { view: "context", icon: "context", label: "Context" },
    { view: "memory", icon: "memory", label: "Memory" },
    { view: "goals", icon: "goals", label: "Goals" },
    { view: "agents", icon: "agents", label: "Agents" },
    { view: "tasks", icon: "tasks", label: "Tasks" },
    { view: "automations", icon: "automations", label: "Automations" },
    { view: "businesses", icon: "businesses", label: "Businesses" },
    { view: "billing", icon: "billing", label: "Billing" },
  ];
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-app py-3" aria-label="Workspace">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#5b48e0] text-sm font-bold text-white shadow-md shadow-accent/20">C</div>
      {items.map((it) => {
        const isActive = active === it.view;
        return (
          <button
            key={it.view}
            onClick={onSelect[it.view]}
            title={it.label}
            aria-label={it.label}
            aria-current={isActive ? "page" : undefined}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              isActive ? "bg-elevated-2 text-ink" : "text-ink-3 hover:bg-elevated hover:text-ink-2"
            }`}
          >
            <Icon name={it.icon} size={19} />
            {it.badge != null && it.badge > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-white">{it.badge}</span>
            )}
            {isActive && <span className="absolute -left-[9px] h-5 w-[3px] rounded-full bg-accent" />}
          </button>
        );
      })}
      <button
        onClick={onToggleTheme}
        title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        aria-label="Toggle theme"
        className="mt-auto flex h-10 w-10 items-center justify-center rounded-xl text-ink-3 transition-colors hover:bg-elevated hover:text-ink-2"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
      </button>
    </nav>
  );
}
