import { useCallback, useEffect, useState } from "react";
import type { Goal, TickResult, AutonomyStatus, Business } from "../api.js";
import type { Repo } from "../types.js";

// #67/#120 autonomy panel: state a goal, decompose it into AGENT-ASSIGNED tasks on
// a repo-bound thread (so the tick can dispatch them), and trigger a manual tick.
// Goals load from the backend (#120) so they persist across navigation.
export function GoalsPanel({
  orgId,
  createGoal,
  decomposeGoal,
  runTick,
  listGoals,
  setGoalAutonomy,
  getAutonomyStatus,
  listBusinesses,
  runGoal,
  repos = [],
  connectRepo,
  ingestRepoIssues,
  setDeployCommand,
  deployRepo,
  threads = [],
  agents = [],
}: {
  orgId: string;
  createGoal: (title: string, criteria?: string, businessId?: string) => Promise<Goal>;
  listBusinesses?: () => Promise<Business[]>;
  runGoal?: (goalId: string) => Promise<{ drafted: { kind: string; reason: string }[]; outcome: { status: string } }>;
  decomposeGoal: (goalId: string, threadId: string, assigneeId?: string) => Promise<{ taskIds: string[] }>;
  runTick: (orgId: string, budgetMax?: number) => Promise<TickResult>;
  listGoals?: () => Promise<Goal[]>;
  setGoalAutonomy?: (goalId: string, on: boolean) => Promise<Goal>;
  getAutonomyStatus?: () => Promise<AutonomyStatus>;
  repos?: Repo[];
  connectRepo?: (input: { githubOwner: string; githubName: string; production?: boolean }) => Promise<Repo>;
  ingestRepoIssues?: (repoId: string) => Promise<{ created: string[]; skipped: number }>;
  setDeployCommand?: (repoId: string, deployCommand: string) => Promise<{ id: string; deployCommand: string | null }>;
  deployRepo?: (repoId: string, goalId?: string) => Promise<{ ok: boolean; url?: string; reason: string }>;
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
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState(""); // #146: optional business target
  useEffect(() => { if (listBusinesses) listBusinesses().then(setBusinesses).catch(() => {}); }, [listBusinesses]);

  const runBiz = async (goalId: string) => {
    if (!runGoal) return;
    setError(null); setNotice("Drafting funnel actions…");
    try { const r = await runGoal(goalId); setNotice(r.drafted.length ? `Drafted ${r.drafted.length}: ${r.drafted.map((d) => d.reason).join("; ")}. Approve them in Businesses.` : `No new drafts (${r.outcome.status}).`); refresh(); }
    catch (e) { setError((e as Error).message); }
  };

  const [status, setStatus] = useState<AutonomyStatus | null>(null);
  const refresh = useCallback(() => {
    if (listGoals) listGoals().then(setGoals).catch((e) => setError((e as Error).message));
    if (getAutonomyStatus) getAutonomyStatus().then(setStatus).catch(() => {});
  }, [listGoals, getAutonomyStatus]);
  useEffect(() => { refresh(); }, [refresh]);
  // Poll the loop status so "next tick" stays live while autonomy is on.
  useEffect(() => {
    if (!getAutonomyStatus) return;
    const id = setInterval(() => getAutonomyStatus().then(setStatus).catch(() => {}), 5000);
    return () => clearInterval(id);
  }, [getAutonomyStatus]);

  const toggleAutonomy = async (g: Goal) => {
    if (!setGoalAutonomy) return;
    setError(null);
    try { await setGoalAutonomy(g.id, !g.autonomy); refresh(); }
    catch (e) { setError((e as Error).message); }
  };

  // #139 connect-a-repo (incl. the platform's own) + ingest its open issues as goals.
  const [repoSpec, setRepoSpec] = useState("");
  const connect = async () => {
    if (!connectRepo) return;
    const [owner, name] = repoSpec.trim().split("/");
    if (!owner || !name) { setError("Enter a repo as owner/name (e.g. gagan114662/agent-chat-platform)."); return; }
    setError(null); setNotice(null);
    try { const r = await connectRepo({ githubOwner: owner, githubName: name }); setNotice(`Connected ${r.githubOwner}/${r.githubName}${r.production ? " (production — merges go through the human gate)" : ""}. Create a thread on it (or ingest its issues) to point goals at it.`); setRepoSpec(""); }
    catch (e) { setError((e as Error).message); }
  };
  const ingest = async (repoId: string) => {
    if (!ingestRepoIssues) return;
    setError(null); setNotice(null);
    try { const out = await ingestRepoIssues(repoId); setNotice(`Ingested ${out.created.length} issue(s) as goals${out.skipped ? `, skipped ${out.skipped} already imported` : ""}. Decompose + turn Auto on to let the loop work them.`); refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  // #140 configure + run a repo's deploy.
  const [deployDraft, setDeployDraft] = useState<Record<string, string>>({});
  const saveDeployCmd = async (repoId: string) => {
    if (!setDeployCommand) return;
    setError(null); setNotice(null);
    try { await setDeployCommand(repoId, deployDraft[repoId] ?? ""); setNotice("Deploy command saved. It must print ACP_DEPLOY_URL=<url>."); refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  const deploy = async (repoId: string) => {
    if (!deployRepo) return;
    setError(null); setNotice("Deploying…");
    try { const r = await deployRepo(repoId); setNotice(r.ok ? `🚀 Live at ${r.url}` : `Deploy failed: ${r.reason}`); refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { if (!threadId && threads[0]) setThreadId(threads[0].id); }, [threads, threadId]);
  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id); }, [agents, agentId]);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const goal = await createGoal(t, criteria.trim() || undefined, businessId || undefined);
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

      {status && (
        <div className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className={status.enabled ? "font-medium text-positive" : "font-medium text-ink-3"}>
            {status.enabled ? "Auto-pilot ON" : "Auto-pilot off"}
          </span>
          {status.enabled && status.nextTickAt && <span className="text-ink-3"> · next tick {Math.max(0, Math.round((status.nextTickAt - Date.now()) / 1000))}s · {status.cycles} cycles run</span>}
          {status.lastSummary && <span className="text-ink-3"> · last: {status.lastSummary.dispatched} dispatched across {status.lastSummary.orgs} org(s)</span>}
          {!status.enabled && <span className="text-ink-3"> · set ACP_AUTONOMY_INTERVAL_MS on the server to start the clock. Toggle a goal's autonomy below to enroll it.</span>}
        </div>
      )}

      {tick && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-2">
          <span className="font-medium text-ink">{tick.dispatched.length} dispatched</span> · {tick.alerts} alerts · {tick.skipped} skipped
          <div className="mt-1 text-ink-3">{tick.reason}</div>
        </div>
      )}
      {notice && <div className="mb-3 rounded-lg border border-positive/30 bg-positive/10 px-3 py-2 text-xs text-positive">{notice}</div>}
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {connectRepo && (
        <div className="mb-4 space-y-2 rounded-lg border border-line bg-surface p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Repos — point the loop at any repo, including its own</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={repoSpec} onChange={(e) => setRepoSpec(e.target.value)} placeholder="owner/name — e.g. gagan114662/agent-chat-platform" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
            <button onClick={connect} disabled={!repoSpec.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">Connect repo</button>
          </div>
          {repos.length > 0 && (
            <ul className="space-y-1">
              {repos.map((r) => (
                <li key={r.id} className="space-y-1 border-t border-line/50 pt-1 text-xs text-ink-2 first:border-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{r.githubOwner}/{r.githubName}
                      {r.production && <span className="ml-1 rounded bg-elevated-2 px-1 py-0.5 text-[10px] uppercase text-ink-3">prod</span>}
                      {r.liveUrl && <a href={r.liveUrl} target="_blank" rel="noreferrer" className="ml-1 text-accent hover:underline">live ↗</a>}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {deployRepo && r.deployCommand && <button onClick={() => deploy(r.id)} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:bg-elevated-2 hover:text-ink">Deploy</button>}
                      {ingestRepoIssues && <button onClick={() => ingest(r.id)} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:bg-elevated-2 hover:text-ink">Ingest issues → goals</button>}
                    </div>
                  </div>
                  {setDeployCommand && (
                    <div className="flex items-center gap-1">
                      <input defaultValue={r.deployCommand ?? ""} onChange={(e) => setDeployDraft((p) => ({ ...p, [r.id]: e.target.value }))} placeholder="deploy command (must print ACP_DEPLOY_URL=<url>)" className="min-w-0 flex-1 rounded border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
                      <button onClick={() => saveDeployCmd(r.id)} className="shrink-0 rounded border border-line px-2 py-0.5 text-[11px] text-ink-3 hover:bg-elevated-2 hover:text-ink">Save</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          {businesses.length > 0 && (
            <select aria-label="target business" value={businessId} onChange={(e) => setBusinessId(e.target.value)} title="Make this a BUSINESS goal — criteria lines become funnel actions (draft charge/campaign), human-approved" className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none">
              <option value="">code goal (repo)</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>🏢 {b.name}</option>)}
            </select>
          )}
        </div>
        {businessId && <p className="text-[11px] text-ink-3">Business goal: each criteria line is a funnel action — e.g. <code>email campaign to a@x.com, b@x.com</code> or <code>charge $39 to dave@x.com</code>. Agents draft; you approve in Businesses.</p>}
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
                  {(g.state ?? g.status) && <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${(g.state ?? g.status) === "done" ? "bg-positive/15 text-positive" : "bg-elevated-2 text-ink-3"}`}>{g.state ?? g.status}</span>}
                  {g.autonomy && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase text-accent">auto</span>}
                  {g.businessId && <span className="rounded bg-positive/15 px-1.5 py-0.5 text-[10px] uppercase text-positive">🏢 business</span>}
                  {(g.iterations ?? 0) > 0 && <span className="text-[10px] text-ink-3">iter {g.iterations}</span>}
                </div>
                {g.criteria && <div className="truncate text-xs text-ink-3">{g.criteria}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {setGoalAutonomy && (g.state ?? g.status) !== "done" && (
                  <button onClick={() => toggleAutonomy(g)} title="When on, the scheduler advances this goal to completion with no Run-now clicks" className={`rounded-lg border px-2 py-1 text-xs ${g.autonomy ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-ink-2 hover:bg-elevated-2 hover:text-ink"}`}>{g.autonomy ? "Auto: on" : "Auto: off"}</button>
                )}
                <button onClick={() => decompose(g.id)} className="rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:bg-elevated-2 hover:text-ink">Decompose</button>
                {g.businessId && runGoal && (g.state ?? g.status) !== "done" && (
                  <button onClick={() => runBiz(g.id)} title="Execute this goal's funnel actions → pending drafts you approve in Businesses" className="rounded-lg border border-positive/40 bg-positive/10 px-2 py-1 text-xs font-medium text-positive hover:bg-positive/20">Run funnel</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
