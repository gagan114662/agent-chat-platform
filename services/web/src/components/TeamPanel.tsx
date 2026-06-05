import { useEffect, useState } from "react";
import type { Principal } from "../types.js";
import { Icon } from "./Icon.js";

// Right-hand roster (reload-style "Team"): humans + agents. Agents show a LIVE
// status — "working" (pulsing) when they have an active run, else "online" (#122)
// — instead of a static badge. Clicking a row opens a DM with that principal.
export function TeamPanel({ principals, onStartDm, listActiveAgents }: {
  principals: Principal[];
  onStartDm?: (peerKind: "human" | "agent", peerId: string) => void;
  listActiveAgents?: () => Promise<string[]>;
}) {
  const humans = principals.filter((p) => p.kind === "human");
  const agents = principals.filter((p) => p.kind === "agent");
  const [active, setActive] = useState<Set<string>>(new Set());

  // Poll which agents are actively working so the badges reflect real runs.
  useEffect(() => {
    if (!listActiveAgents) return;
    let on = true;
    const tick = () => listActiveAgents().then((ids) => { if (on) setActive(new Set(ids)); }).catch(() => {});
    tick();
    const h = setInterval(tick, 5000);
    return () => { on = false; clearInterval(h); };
  }, [listActiveAgents]);

  const working = agents.filter((a) => active.has(a.id)).length;

  const row = (p: Principal) => {
    const isAgent = p.kind === "agent";
    const isWorking = isAgent && active.has(p.id);
    return (
      <button
        key={p.id}
        onClick={() => onStartDm?.(p.kind, p.id)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-elevated"
      >
        <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white ${isAgent ? "bg-gradient-to-br from-accent to-[#5b48e0]" : "bg-elevated-2 text-ink-2"}`}>
          {isAgent ? <Icon name="agents" size={14} className="text-white" /> : p.name.slice(0, 2).toUpperCase()}
          {isAgent && <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${isWorking ? "animate-pulse bg-warn" : "bg-positive"}`} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
          <span className={`block text-[11px] ${isWorking ? "text-warn" : "text-ink-3"}`}>{isAgent ? (isWorking ? "agent · working…" : "agent · online") : "member"}</span>
        </span>
      </button>
    );
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-l border-line bg-surface lg:flex">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[13px] font-semibold text-ink">Team</div>
        <div className="mt-0.5 text-[11px] text-ink-3">{humans.length} {humans.length === 1 ? "human" : "humans"} · {agents.length} {agents.length === 1 ? "agent" : "agents"}{working > 0 && <span className="text-warn"> · {working} working</span>}</div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {agents.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Agents</div>
            <div className="space-y-0.5">{agents.map(row)}</div>
          </div>
        )}
        {humans.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">People</div>
            <div className="space-y-0.5">{humans.map(row)}</div>
          </div>
        )}
        {principals.length === 0 && <p className="px-2 text-xs text-ink-3">No members yet.</p>}
      </div>
    </aside>
  );
}
