import { useState } from "react";
import type { MemoryGraph, MemoryStats, MemoryKind, MemoryScope } from "../types.js";

const KIND_COLOR: Record<MemoryKind, string> = {
  decision: "#2563eb",
  fact: "#15151f",
  preference: "#7c3aed",
  identity: "#059669",
  artifact: "#d97706",
};

const SCOPES: { label: string; value: MemoryScope | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Personal", value: "personal" },
  { label: "Project", value: "project" },
  { label: "Team", value: "team" },
  { label: "Org", value: "org" },
];

const KINDS: { label: string; value: MemoryKind | undefined }[] = [
  { label: "All", value: undefined },
  { label: "decision", value: "decision" },
  { label: "fact", value: "fact" },
  { label: "preference", value: "preference" },
  { label: "identity", value: "identity" },
  { label: "artifact", value: "artifact" },
];

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs ${
        active ? "bg-[#15151f] font-medium text-white" : "border border-[#e7e7f0] bg-white text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}

export function ContextExplorer({
  graph,
  stats,
  scope,
  onScopeChange,
  kind,
  onKindChange,
  loading,
}: {
  graph: MemoryGraph;
  stats: MemoryStats;
  scope: MemoryScope | undefined;
  onScopeChange: (scope: MemoryScope | undefined) => void;
  kind: MemoryKind | undefined;
  onKindChange: (kind: MemoryKind | undefined) => void;
  loading: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nodes = graph.nodes;
  const n = nodes.length;
  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const neighborCount = selected
    ? graph.edges.filter((e) => e.fromId === selected.id || e.toId === selected.id).length
    : 0;

  // Deterministic circular layout.
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const radius = n > 1 ? size / 2 - 40 : 0;
  const pos = (i: number) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1);
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  };
  const posById = new Map(nodes.map((node, i) => [node.id, pos(i)]));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-white p-6 text-sm text-neutral-800">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-[#15151f]">Context Explorer</h1>
        <div className="text-xs text-neutral-500">
          {stats.nodes} memories · {stats.edges} edges{loading ? " · loading…" : ""}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {SCOPES.map((s) => (
          <Chip key={s.label} label={s.label} active={scope === s.value} onClick={() => onScopeChange(s.value)} />
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <Chip key={k.label} label={k.label} active={kind === k.value} onClick={() => onKindChange(k.value)} />
        ))}
      </div>

      {n === 0 ? (
        <div className="rounded-xl border border-[#e7e7f0] bg-white p-8 text-center text-neutral-400">
          No memories captured yet.
        </div>
      ) : (
        <div className="flex flex-1 gap-6">
          <svg width={size} height={size} className="shrink-0 rounded-xl border border-[#e7e7f0]" role="img" aria-label="memory graph">
            {graph.edges.map((e) => {
              const a = posById.get(e.fromId);
              const b = posById.get(e.toId);
              if (!a || !b) return null;
              return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e7e7f0" strokeWidth={1.5} />;
            })}
            {nodes.map((node) => {
              const p = posById.get(node.id)!;
              const isSel = node.id === selectedId;
              return (
                <g key={node.id} onClick={() => setSelectedId(node.id)} style={{ cursor: "pointer" }} aria-label={node.label}>
                  <circle cx={p.x} cy={p.y} r={isSel ? 10 : 7} fill={KIND_COLOR[node.kind]} stroke={isSel ? "#15151f" : "white"} strokeWidth={2} />
                </g>
              );
            })}
          </svg>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ul className="flex flex-col gap-1">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    onClick={() => setSelectedId(node.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                      node.id === selectedId ? "bg-[#15151f] text-white" : "text-neutral-700 hover:bg-neutral-100"
                    }`}
                  >
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[node.kind] }} />
                    <span className="truncate">{node.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            {selected && (
              <div className="rounded-xl border border-[#e7e7f0] bg-white p-4">
                <div className="text-sm font-semibold text-[#15151f]">{selected.label}</div>
                <div className="mb-2 text-xs text-neutral-400">
                  {selected.kind} · {selected.scope} · {neighborCount} neighbors
                </div>
                {selected.body && <div className="whitespace-pre-wrap text-sm text-neutral-700">{selected.body}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
