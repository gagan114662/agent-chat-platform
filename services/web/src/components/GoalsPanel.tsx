import { useState } from "react";
import type { Goal, TickResult } from "../api.js";

// #67 autonomy panel: state a goal, decompose it into tasks (needs a threadId),
// and trigger a manual self-prompt tick. The backend has no list-goals route, so
// the panel tracks the goals created in-session locally.
export function GoalsPanel({
  orgId,
  createGoal,
  decomposeGoal,
  runTick,
}: {
  orgId: string;
  createGoal: (title: string, criteria?: string) => Promise<Goal>;
  decomposeGoal: (goalId: string, threadId: string) => Promise<{ taskIds: string[] }>;
  runTick: (orgId: string, budgetMax?: number) => Promise<TickResult>;
}) {
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tick, setTick] = useState<TickResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true); setError(null);
    try {
      const goal = await createGoal(t, criteria.trim() || undefined);
      setGoals((prev) => [goal, ...prev]);
      setTitle(""); setCriteria("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decompose = async (goalId: string) => {
    const threadId = window.prompt("Thread id to decompose into?");
    if (!threadId) return;
    setError(null);
    try {
      await decomposeGoal(goalId, threadId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onRunTick = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      setTick(await runTick(orgId, undefined));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Goals</h2>
        <button
          onClick={onRunTick}
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Run now
        </button>
      </div>

      {tick && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className="font-medium">{tick.dispatched.length} dispatched</span>
          {" · "}
          <span>{tick.alerts} alerts</span>
          {" · "}
          <span>{tick.skipped} skipped</span>
          <div className="mt-1 text-ink-3">{tick.reason}</div>
        </div>
      )}

      <div className="mb-4 space-y-2 rounded-lg border border-line bg-surface p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal title"
          className="w-full rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <input
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="Success criteria (optional)"
          className="w-full rounded-lg border border-line px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a4ac4] disabled:opacity-50"
        >
          Create goal
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {goals.length === 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-line bg-surface px-3 py-3 text-xs text-ink-3">
          No goals yet. A good goal is outcome-shaped with clear success criteria. Examples:
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li><span className="text-ink-2">Ship dark mode</span> — criteria: toggle works, persists, all panels themed.</li>
            <li><span className="text-ink-2">Cut p95 API latency below 200ms</span> — criteria: dashboard shows &lt;200ms for 24h.</li>
          </ul>
          Create one above, then <span className="text-ink-2">Decompose</span> it into tasks your agents can pick up.
        </div>
      )}
      <ul className="space-y-2">
        {goals.map((g) => (
          <li key={g.id} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">{g.title}</div>
                <div className="text-xs text-ink-3">{g.id}{g.criteria ? ` · ${g.criteria}` : ""}</div>
              </div>
              <button
                onClick={() => decompose(g.id)}
                className="rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:bg-elevated-2"
              >
                Decompose
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
