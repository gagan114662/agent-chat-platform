import { useEffect, useState } from "react";
import type { MemoryGraph, MemoryStats, MemoryKind, MemoryScope } from "./types.js";
import { memoryGraph, memoryStats } from "./api.js";

const EMPTY_GRAPH: MemoryGraph = { nodes: [], edges: [] };
const EMPTY_STATS: MemoryStats = { nodes: 0, edges: 0 };

// Loads memory stats + graph for the current scope/kind filter; refetches on filter change.
export function useMemory() {
  const [scope, setScope] = useState<MemoryScope | undefined>(undefined);
  const [kind, setKind] = useState<MemoryKind | undefined>(undefined);
  const [graph, setGraph] = useState<MemoryGraph>(EMPTY_GRAPH);
  const [stats, setStats] = useState<MemoryStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([memoryGraph({ scope, kind }), memoryStats()])
      .then(([g, s]) => {
        if (cancelled) return;
        setGraph(g);
        setStats(s);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, kind]);

  return { graph, stats, scope, setScope, kind, setKind, loading };
}
