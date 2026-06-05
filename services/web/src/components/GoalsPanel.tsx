import { useCallback, useEffect, useState } from "react";
import type { Goal, TickResult } from "../api.js";

// #67/#120 autonomy panel: state a goal, decompose it into AGENT-ASSIGNED tasks on
// a repo-bound thread (so the tick can dispatch them), and trigger a manual tick.
// Goals load from the backend (#120) so they persist across navigation.
export function GoalsPanel({
  orgId,
  createGoal,
  decomposeGoal,
  runTick,
  listGoals,
  threads = [],
  agents = [],
}: {
  orgId: string;
  createGoal: (title: string, criteria?: string) => Promise<Goal>;
  decomposeGoal: (goalId: string, threadId: string, assigneeId?: string) => Promise<{ taskIds: string[] }>;
  runTick: (orgId: string, budgetMax?: number) => Promise<TickResult>;
  listGoals?: () => Promise<Goal[]>;
  // Repo-bound threads the decomposed tasks run against, and agents to assign them to.
  threads?: { id: string; title: string }[];
  agents?: { id: string; handle: string }[];
}) {
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tick, setTick] = useState<TickResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [threadId, setThreadId] = useState("");
  const [agentId, setAgentId] = useState("");

  const refresh = useCallback(() => {
    if (listGoals) listGoals().then(setGoals).catch((e) => setError((e as Error).message));
  }, [listGoals]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (!threadId && threads[0]) setThreadId(threads[0].id); }, [threads, threadId]);
  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const goal = await createGoal(t, criteria.trim() || undefined);
      setGoals((prev) => [goal, ...prev.filter((g) => g.id !== goal.id)]);
      setTitle(""); setCriteria("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const decompose = async (goalId: string) => {
    setError(null); setNotice(null);
    if (!threadId) { setError("Pick a repo-bound thread to decompose into (create one in a channel with a repo first)."); return; }
    try {
      const { taskIds } = await decomposeGoal(goalId, threadId, agentId || undefined);
      const who = agents.find((a) => a.id === agentId)?.handle;
      setNotice(taskIds.length === 0
        ? "No tasks created — the goal may already be decomposed (it's idempotent). Check the Tasks board."
        : `Created ${taskIds.length} task${taskIds.length === 1 ? "" : "s"}${who ? ` assigned to @${who}` : ""}. Open Tasks to see them, then Run now to dispatch.`);
      refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const onRunTick = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { setTick(await runTick(orgId, undefined)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const inputCls = "w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Goals</h2>
        <button onClick={onRunTick} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">Run now</button>
      </div>

      {tick && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className="font-medium text-ink">{tick.dispatched.length} dispatched</span> · {tick.alerts} alerts · {tick.skipped} skipped
          <div className="mt-1 text-ink-3">{tick.reason}</div>
        </div>
      )}
      {notice && <div className="mb-3 rounded-lg border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-positive">{notice}</div>}
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      <div className="mb-4 space-y-2 rounded-lg border border-line bg-surface p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title — e.g. Launch a paid resume-review service & land the first customer" className={inputCls} />
        <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder={"Success criteria, one per line (each becomes a task). e.g.\n- Build a landing page with a Stripe checkout\n- Deploy it to a public URL\n- Take one real payment"} rows={3} className={inputCls} />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={submit} disabled={busy || !title.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">Create goal</button>
          <span className="text-[11px] text-ink-3">Decompose target:</span>
          <select aria-label="decompose thread" value={threadId} onChange={(e) => setThreadId(e.target.value)} className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
            {threads.length === 0 && <option value="">no repo-bound thread</option>}
            {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <select aria-label="decompose agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
            {agents.length === 0 && <option value="">no agent</option>}
            {agents.map((a) => <option key={a.id} value={a.id}>@{a.handle}</option>)}
          </select>
        </div>
      </div>

      {goals.length === 0 && (
        <div className="mb-2 rounded-lg border border-dashed border-line bg-surface px-3 py-3 text-xs text-ink-3">
          No goals yet. A good goal is outcome-shaped, with each success criterion on its own line (each becomes a task). Examples:
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li><span className="text-ink-2">Launch a paid AI resume-review service</span> — landing page + Stripe checkout; live public URL; first real payment.</li>
            <li><span className="text-ink-2">Stand up a docs site for product X</span> — build the site; deploy; link it from the README.</li>
            <li><span className="text-ink-2">Ship dark mode</span> — toggle works + persists; all panels themed.</li>
          </ul>
          Tasks run via the agent + repo loop (the agent builds code/content and opens a PR). Steps that need the real world — signing up for accounts, taking a phone call — stay with you; money moves only through the human gate.
        </div>
      )}
      <ul className="space-y-2">
        {goals.map((g) => (
          <li key={g.id} className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">{g.title}</span>
                  {(g.state ?? g.status) && <span className="rounded bg-elevated-2 px-1.5 py-0.5 text-[10px] uppercase text-ink-3">{g.state ?? g.status}</span>}
                </div>
                {g.criteria && <div className="truncate text-xs text-ink-3">{g.criteria}</div>}
              </div>
              <button onClick={() => decompose(g.id)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:bg-elevated-2 hover:text-ink">Decompose</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
