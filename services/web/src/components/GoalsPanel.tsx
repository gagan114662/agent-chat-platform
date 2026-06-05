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
        <h2 className="text-sm font-semibold text-neutral-800">Goals</h2>
        <button
          onClick={onRunTick}
          disabled={busy}
          className="rounded-lg bg-[#15151f] px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
        >
          Run tick
        </button>
      </div>

      {tick && (
        <div className="mb-4 rounded-lg border border-[#e7e7f0] bg-white px-3 py-2 text-xs text-neutral-700">
          <span className="font-medium">{tick.dispatched.length} dispatched</span>
          {" · "}
          <span>{tick.alerts} alerts</span>
          {" · "}
          <span>{tick.skipped} skipped</span>
          <div className="mt-1 text-neutral-400">{tick.reason}</div>
        </div>
      )}

      <div className="mb-4 space-y-2 rounded-lg border border-[#e7e7f0] bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Goal title"
          className="w-full rounded-lg border border-[#e7e7f0] px-2 py-1.5 text-sm focus:border-neutral-800 focus:outline-none"
        />
        <input
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder="Success criteria (optional)"
          className="w-full rounded-lg border border-[#e7e7f0] px-2 py-1.5 text-sm focus:border-neutral-800 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded-lg bg-[#5b5bd6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a4ac4] disabled:opacity-50"
        >
          Create goal
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

      <ul className="space-y-2">
        {goals.map((g) => (
          <li key={g.id} className="rounded-lg border border-[#e7e7f0] bg-white px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-neutral-800">{g.title}</div>
                <div className="text-xs text-neutral-400">{g.id}{g.criteria ? ` · ${g.criteria}` : ""}</div>
              </div>
              <button
                onClick={() => decompose(g.id)}
                className="rounded-lg border border-[#e7e7f0] px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
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
