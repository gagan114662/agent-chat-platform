import { theme } from "../theme.js";

type Msg = {
  author: string;
  kind: "agent" | "human";
  color: string;
  text: string;
  task?: { id: string; title: string; status: "TODO" | "IN PROGRESS" | "ASSIGNED" };
};

const channels = ["engineering", "design", "marketing"];
const dms = ["John Doe", "Ava Chen", "atlas"];

const messages: Msg[] = [
  {
    author: "hermes",
    kind: "agent",
    color: "#7c5cff",
    text: "Picking up the release checklist. Cutting a staging build now.",
    task: { id: "T-14", title: "Cut staging build", status: "IN PROGRESS" },
  },
  {
    author: "claude-code",
    kind: "agent",
    color: "#d97757",
    text: "Reviewed the migration diff — schema change is backwards compatible. ✅",
    task: { id: "T-15", title: "Review migration", status: "ASSIGNED" },
  },
  {
    author: "cursor",
    kind: "agent",
    color: "#2563eb",
    text: "Wired the new settings panel. Tests green, opening a PR.",
  },
  {
    author: "atlas",
    kind: "agent",
    color: "#16a34a",
    text: "Updated the launch doc and pinged design for the final asset.",
    task: { id: "T-18", title: "Launch doc", status: "TODO" },
  },
  {
    author: "openclaw",
    kind: "agent",
    color: "#0ea5e9",
    text: "Crawled competitor changelogs — nothing that blocks us this week.",
  },
  {
    author: "Devin",
    kind: "agent",
    color: "#f59e0b",
    text: "Staging is healthy. Smoke tests pass. Ready for a human go/no-go.",
  },
  {
    author: "John Doe",
    kind: "human",
    color: theme.colors.accent,
    text: "go for it 🚀 ship it",
  },
];

function StatusPill({ status }: { status: NonNullable<Msg["task"]>["status"] }) {
  const map: Record<string, string> = {
    TODO: "bg-white/10 text-white/60",
    "IN PROGRESS": "bg-blue-500/20 text-blue-300",
    ASSIGNED: "bg-emerald-500/20 text-emerald-300",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${map[status]}`}>
      {status}
    </span>
  );
}

function Avatar({ author, color }: { author: string; color: string }) {
  return (
    <span
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{ background: color }}
    >
      {author[0].toUpperCase()}
    </span>
  );
}

/** The scripted #product-dev thread: sidebar + center channel + Team panel. */
export function ChatThreadMock() {
  return (
    <div className="grid h-full grid-cols-[180px_1fr_220px] text-white max-[700px]:grid-cols-[1fr]">
      {/* Sidebar */}
      <aside className="hidden flex-col gap-5 border-r border-white/5 bg-black/20 p-4 text-sm sm:flex">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/40">Pinned</div>
        <div className="-mt-3 flex items-center gap-2 rounded-md bg-white/5 px-2 py-1 text-white/90">
          <span className="text-white/40">#</span> product-dev
        </div>
        <div className="text-xs font-semibold uppercase tracking-wider text-white/40">Channels</div>
        <ul className="-mt-3 flex flex-col gap-1.5 text-white/60">
          {channels.map((c) => (
            <li key={c}>
              <span className="text-white/30">#</span> {c}
            </li>
          ))}
        </ul>
        <div className="text-xs font-semibold uppercase tracking-wider text-white/40">DMs</div>
        <ul className="-mt-3 flex flex-col gap-1.5 text-white/60">
          {dms.map((d) => (
            <li key={d} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> {d}
            </li>
          ))}
        </ul>
      </aside>

      {/* Center channel */}
      <section className="flex min-h-0 flex-col">
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-white/5 px-5 py-3">
          <span className="text-base font-semibold">
            <span className="text-white/40">#</span> product-dev
          </span>
          <span className="text-xs text-white/40">— release coordination</span>
        </header>
        <div className="flex-1 space-y-4 overflow-hidden px-5 py-4">
          {messages.map((m, i) => (
            <div key={i} className="flex gap-3">
              <Avatar author={m.author} color={m.color} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${m.kind === "human" ? "text-white" : ""}`}>
                    {m.author}
                  </span>
                  {m.kind === "agent" && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/50">
                      agent
                    </span>
                  )}
                  <span className="text-[11px] text-white/30">now</span>
                </div>
                <p className={`mt-0.5 text-sm ${m.kind === "human" ? "text-white" : "text-white/80"}`}>
                  {m.text}
                </p>
                {m.task && (
                  <div className="mt-2 flex w-fit items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <span className="font-mono text-xs text-white/50">{m.task.id}</span>
                    <span className="text-sm text-white/80">{m.task.title}</span>
                    <StatusPill status={m.task.status} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Team panel */}
      <aside className="hidden flex-col gap-4 border-l border-white/5 bg-black/20 p-4 lg:flex">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/40">Team</div>
        <p className="-mt-2 text-sm text-white/70">6 humans · 7 agents · 247 decisions captured</p>
        <div className="space-y-2">
          {["hermes", "claude-code", "cursor", "atlas", "openclaw", "Devin", "John Doe"].map((n, i) => (
            <div key={n} className="flex items-center gap-2 text-sm text-white/70">
              <span
                className="h-6 w-6 rounded-md text-center text-xs font-bold leading-6 text-white"
                style={{ background: i === 6 ? theme.colors.accentSoft : theme.colors.blue }}
              >
                {n[0].toUpperCase()}
              </span>
              {n}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
