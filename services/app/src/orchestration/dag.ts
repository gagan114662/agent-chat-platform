// #150.2 orchestrator-centric execution graph. Unrestricted message-bus designs
// (the "Chaos Pattern") are non-deterministic and loop-prone. A DAG of explicit
// role-steps (Planner / Researcher / Coder / Reviewer …) runs in a defined order,
// with the orchestrator holding central context and passing only the relevant prior
// results to each node, plus a human-in-the-loop gate to approve/skip a node.

export interface DagNode { id: string; role: string; task: string; deps?: string[] }
export type NodeExec = (node: DagNode, context: Record<string, unknown>) => Promise<unknown>;
export type NodeGate = (node: DagNode, context: Record<string, unknown>) => Promise<boolean>; // false → skip

export interface DagRun { order: string[]; results: Record<string, unknown>; skipped: string[] }

// topoOrder: a deterministic topological ordering; throws on a cycle (no chaos loops)
// or an unknown dependency.
export function topoOrder(nodes: DagNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=unseen 1=visiting 2=done
  const order: string[] = [];
  const visit = (id: string, stack: string[]): void => {
    const st = state.get(id) ?? 0;
    if (st === 2) return;
    if (st === 1) throw new Error(`cycle detected: ${[...stack, id].join(" → ")}`);
    const n = byId.get(id);
    if (!n) throw new Error(`unknown node "${id}"`);
    state.set(id, 1);
    for (const d of n.deps ?? []) {
      if (!byId.has(d)) throw new Error(`node "${id}" depends on unknown "${d}"`);
      visit(d, [...stack, id]);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const n of nodes) visit(n.id, []);
  return order;
}

// runGraph: execute nodes in topological order. Each node receives the orchestrator's
// context (its dependencies' results, keyed by node id). A gate (human hook) may skip
// a node; a skipped node's dependents still run (with that result absent). Returns the
// order, per-node results, and which were skipped.
export async function runGraph(nodes: DagNode[], exec: NodeExec, opts?: { gate?: NodeGate }): Promise<DagRun> {
  const order = topoOrder(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const results: Record<string, unknown> = {};
  const skipped: string[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    // central context: only the relevant prior results (this node's deps) — keeps
    // each worker's context minimal (cuts tokens, avoids overflow).
    const context: Record<string, unknown> = {};
    for (const d of node.deps ?? []) if (d in results) context[d] = results[d];
    if (opts?.gate && !(await opts.gate(node, context))) { skipped.push(id); continue; }
    results[id] = await exec(node, context);
  }
  return { order, results, skipped };
}
