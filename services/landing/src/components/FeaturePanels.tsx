import { AppWindow } from "./AppWindow.js";

const teamColor = (i: number) => ["#7c5cff", "#2563eb", "#16a34a"][i % 3];

/** 01 — Agent pools (teams + add) over a tasks board. */
export function AgentPoolsPanel() {
  const pools = [
    { name: "Engineering", agents: ["claude-code", "cursor", "Devin"] },
    { name: "Design", agents: ["atlas", "figma-bot"] },
    { name: "Growth", agents: ["openclaw", "hermes"] },
  ];
  const tasks = [
    { id: "T-12", title: "Ship settings panel", status: "Done", who: "cursor", due: "Today" },
    { id: "T-15", title: "Review migration", status: "In review", who: "claude-code", due: "Today" },
    { id: "T-18", title: "Launch doc", status: "Doing", who: "atlas", due: "Tue" },
    { id: "T-21", title: "Pricing experiment", status: "Todo", who: "openclaw", due: "Thu" },
  ];
  return (
    <AppWindow title="Convene — Agents">
      <div className="flex h-full flex-col gap-4 p-5 text-white">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            Agent pools
          </div>
          <div className="flex flex-wrap gap-2">
            {pools.map((p, i) => (
              <div key={p.name} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-2 flex -space-x-1.5">
                  {p.agents.map((a) => (
                    <span
                      key={a}
                      title={a}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-[#15151f] text-[10px] font-bold text-white"
                      style={{ background: teamColor(i) }}
                    >
                      {a[0].toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <button className="rounded-lg border border-dashed border-white/20 px-4 text-sm text-white/50">
              + ADD
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
            Tasks
          </div>
          <div className="overflow-hidden rounded-lg border border-white/10">
            {tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-white/5 px-3 py-2 text-sm last:border-0"
              >
                <span className="font-mono text-xs text-white/40">{t.id}</span>
                <span className="flex-1 truncate text-white/85">{t.title}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                  {t.status}
                </span>
                <span className="hidden text-xs text-white/50 sm:inline">{t.who}</span>
                <span className="text-xs text-white/40">{t.due}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppWindow>
  );
}

/** 02 — Context Explorer graph with 258 memories · 463 edges. */
export function ContextGraphPanel() {
  const nodes = [
    { x: 50, y: 30 }, { x: 25, y: 55 }, { x: 75, y: 50 },
    { x: 40, y: 80 }, { x: 68, y: 78 }, { x: 15, y: 30 },
    { x: 88, y: 28 }, { x: 55, y: 58 },
  ];
  const filters = ["Personal", "Project", "Team", "Org"];
  return (
    <AppWindow title="Convene — Context Explorer">
      <div className="flex h-full flex-col p-5 text-white">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Context Explorer</div>
          <div className="text-xs text-white/50">258 memories · 463 edges</div>
        </div>
        <div className="mt-3 flex gap-2">
          {filters.map((f, i) => (
            <span
              key={f}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                i === 1 ? "bg-blue-500/30 text-blue-200" : "bg-white/10 text-white/60"
              }`}
            >
              {f}
            </span>
          ))}
        </div>
        <div className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/20">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {nodes.map((n, i) =>
              nodes.slice(i + 1).map((m, j) =>
                (i + j) % 2 === 0 ? (
                  <line
                    key={`${i}-${j}`}
                    x1={n.x} y1={n.y} x2={m.x} y2={m.y}
                    stroke="#ffffff" strokeOpacity="0.12" strokeWidth="0.3"
                  />
                ) : null,
              ),
            )}
            {nodes.map((n, i) => (
              <circle
                key={i} cx={n.x} cy={n.y} r={i === 0 ? 3 : 2}
                fill={i === 0 ? "#2563eb" : "#7c5cff"}
              />
            ))}
          </svg>
        </div>
      </div>
    </AppWindow>
  );
}

/** 03 — Approval / mention view. */
export function ApprovalPanel() {
  return (
    <AppWindow title="Convene — Inbox">
      <div className="flex h-full flex-col gap-3 p-5 text-white">
        <div className="text-sm font-semibold">Needs your attention</div>
        <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded bg-blue-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">
              APPROVAL
            </span>
            <span className="text-white/80">@you mentioned by</span>
            <span className="font-semibold">Devin</span>
          </div>
          <p className="mt-2 text-sm text-white/80">
            Staging build is green. Requesting go/no-go before production deploy.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold">
              Approve
            </button>
            <button className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/70">
              Hold
            </button>
          </div>
        </div>
        {["Budget threshold reached on T-21", "PR #482 ready for review"].map((t) => (
          <div key={t} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
            {t}
          </div>
        ))}
      </div>
    </AppWindow>
  );
}

/** 04 — Captured decision view. */
export function DecisionCapturePanel() {
  const decisions = [
    { d: "Ship v2 settings panel", by: "John Doe", when: "Today 14:02" },
    { d: "Defer pricing experiment to next sprint", by: "Ava Chen", when: "Yesterday" },
    { d: "Adopt backwards-compatible migration", by: "claude-code", when: "Mon" },
  ];
  return (
    <AppWindow title="Convene — Decisions">
      <div className="flex h-full flex-col gap-3 p-5 text-white">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Decisions captured</div>
          <span className="text-xs text-white/50">auto-logged · 247 total</span>
        </div>
        <div className="space-y-2">
          {decisions.map((x) => (
            <div key={x.d} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-white/90">{x.d}</span>
              </div>
              <div className="mt-1 pl-4 text-xs text-white/45">
                by {x.by} · {x.when}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppWindow>
  );
}
