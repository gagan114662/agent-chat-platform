import { useEffect, useState } from "react";
import type { MemoryNode } from "../api.js";

// #26/#40/#82 memory panel: a recall search box (intent → ranked nodes), a
// "Consolidate memory" button that clusters recent nodes into summaries and
// shows the created count, and a list of recent nodes. Reads only-existing
// routes: GET /memory/recall, POST /memory/consolidate, GET /memory.
function NodeCard({ n }: { n: MemoryNode }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-elevated-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">{n.kind}</span>
        <span className="text-sm font-medium text-ink">{n.label}</span>
      </div>
      {n.body && <div className="mt-1 text-xs text-ink-3">{n.body}</div>}
    </li>
  );
}

export function MemoryPanel({
  memoryRecall,
  memoryConsolidate,
  listMemoryNodes,
}: {
  memoryRecall: (q: string) => Promise<MemoryNode[]>;
  memoryConsolidate: () => Promise<{ created: number; clusters: number }>;
  listMemoryNodes: (q?: string) => Promise<MemoryNode[]>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MemoryNode[] | null>(null);
  const [recent, setRecent] = useState<MemoryNode[]>([]);
  const [consolidated, setConsolidated] = useState<{ created: number; clusters: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = () => {
    listMemoryNodes().then(setRecent).catch((e) => setError((e as Error).message));
  };

  useEffect(loadRecent, [listMemoryNodes]);

  const search = async () => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true); setError(null);
    try {
      setResults(await memoryRecall(query));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const consolidate = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await memoryConsolidate();
      setConsolidated(r);
      loadRecent(); // dreaming creates summary nodes — refresh the recent list
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Memory</h2>
        <button
          onClick={consolidate}
          disabled={busy}
          title="Cluster recent memories into higher-level summaries"
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Consolidate memory
        </button>
      </div>
      <p className="mb-4 text-xs text-ink-3">Search &amp; recall memories and consolidate them into summaries — to see how they connect as a graph, use <span className="text-ink-2">Context</span>.</p>

      {consolidated && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className="font-medium">{consolidated.created} created</span>
          {" · "}
          <span>{consolidated.clusters} clusters</span>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }}
          placeholder="Recall by intent…"
          className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={search}
          disabled={busy || !q.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a4ac4] disabled:opacity-50"
        >
          Search
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {results !== null && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Recall results</h3>
          {results.length === 0 ? (
            <p className="text-xs text-ink-3">No matching memory.</p>
          ) : (
            <ul className="space-y-2">{results.map((n) => <NodeCard key={n.id} n={n} />)}</ul>
          )}
        </div>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Recent nodes</h3>
      {recent.length === 0 ? (
        <p className="text-xs text-ink-3">No memory nodes yet.</p>
      ) : (
        <ul className="space-y-2">{recent.map((n) => <NodeCard key={n.id} n={n} />)}</ul>
      )}
    </div>
  );
}
