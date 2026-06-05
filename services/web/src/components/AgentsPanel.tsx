import { useEffect, useState } from "react";
import type { Agent, AgentVisibility, SkillDoc } from "../api.js";

// #58/#91 agents panel: list the org's agents and edit each one's profile
// (visibility public|private + optional avatar URL) via PATCH /agents/:id/profile.
// There is no set-model route, so the model/adapter is shown read-only.
export function AgentsPanel({
  listAgents,
  setAgentProfile,
  createAgent,
  getAgentSkill,
  saveAgentSkill,
  optimizeAgentSkill,
}: {
  listAgents: () => Promise<Agent[]>;
  setAgentProfile: (agentId: string, patch: { avatarUrl?: string | null; visibility?: AgentVisibility }) => Promise<Agent>;
  createAgent?: (input: { handle: string; displayName: string; adapter?: string }) => Promise<Agent>;
  getAgentSkill?: (agentId: string) => Promise<{ latest: SkillDoc | null; versions: SkillDoc[] }>;
  saveAgentSkill?: (agentId: string, content: string) => Promise<SkillDoc>;
  optimizeAgentSkill?: (agentId: string) => Promise<{ accepted: boolean; version?: number; reason: string; beforeScore: number; afterScore?: number }>;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState<Record<string, { visibility: AgentVisibility; avatarUrl: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [nh, setNh] = useState(""); const [nn, setNn] = useState(""); const [na, setNa] = useState("claude-code");
  const [adding, setAdding] = useState(false);
  // #131 per-agent skill editor (open agent id → its draft content + version).
  const [skillOpen, setSkillOpen] = useState<string | null>(null);
  const [skillText, setSkillText] = useState("");
  const [skillVer, setSkillVer] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [optMsg, setOptMsg] = useState<string | null>(null);

  const optimizeSkill = async (agentId: string) => {
    if (!optimizeAgentSkill || optimizing) return;
    setOptimizing(true); setOptMsg(null);
    try {
      const r = await optimizeAgentSkill(agentId);
      if (r.accepted) {
        setOptMsg(`Learned a lesson → v${r.version} (score ${r.beforeScore.toFixed(2)} → ${r.afterScore?.toFixed(2)})`);
        if (getAgentSkill) { const s = await getAgentSkill(agentId); setSkillText(s.latest?.content ?? ""); setSkillVer(s.latest?.version ?? 0); }
      } else {
        setOptMsg(`No improvement — kept v${skillVer} (${r.reason})`);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setOptimizing(false); }
  };

  const openSkill = async (agentId: string) => {
    if (skillOpen === agentId) { setSkillOpen(null); return; }
    setSkillOpen(agentId); setSkillText(""); setSkillVer(0);
    if (getAgentSkill) {
      try { const s = await getAgentSkill(agentId); setSkillText(s.latest?.content ?? ""); setSkillVer(s.latest?.version ?? 0); }
      catch (e) { setError((e as Error).message); }
    }
  };
  const saveSkill = async (agentId: string) => {
    if (!saveAgentSkill) return;
    try { const v = await saveAgentSkill(agentId, skillText); setSkillVer(v.version); }
    catch (e) { setError((e as Error).message); }
  };

  const addAgent = async () => {
    if (!createAgent || !nh.trim() || !nn.trim() || adding) return;
    setAdding(true); setError(null);
    try {
      const a = await createAgent({ handle: nh.trim(), displayName: nn.trim(), adapter: na });
      setAgents((prev) => [a, ...prev]);
      setDraft((prev) => ({ ...prev, [a.id]: { visibility: a.visibility, avatarUrl: a.avatarUrl ?? "" } }));
      setNh(""); setNn("");
    } catch (e) { setError((e as Error).message); }
    finally { setAdding(false); }
  };

  useEffect(() => {
    listAgents()
      .then((rows) => {
        setAgents(rows);
        setDraft(Object.fromEntries(rows.map((a) => [a.id, { visibility: a.visibility, avatarUrl: a.avatarUrl ?? "" }])));
      })
      .catch((e) => setError((e as Error).message));
  }, [listAgents]);

  const save = async (a: Agent) => {
    const d = draft[a.id];
    if (!d) return;
    setError(null);
    try {
      const updated = await setAgentProfile(a.id, { visibility: d.visibility, avatarUrl: d.avatarUrl.trim() || null });
      setAgents((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-4 text-sm font-semibold text-ink">Agents</h2>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      {createAgent && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Add an agent</div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={nh} onChange={(e) => setNh(e.target.value)} placeholder="handle (e.g. coder)" aria-label="new agent handle" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
            <input value={nn} onChange={(e) => setNn(e.target.value)} placeholder="display name" aria-label="new agent name" className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none" />
            <select value={na} onChange={(e) => setNa(e.target.value)} aria-label="new agent adapter" className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none">
              <option value="claude-code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="devin">Devin</option>
              <option value="openclaw">Openclaw</option>
              <option value="hermes">Hermes</option>
              <option value="fake">Demo (no-op)</option>
            </select>
            <button onClick={addAgent} disabled={adding || !nh.trim() || !nn.trim()} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">Add agent</button>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Claude Code, Codex, Cursor, Devin, Openclaw &amp; Hermes run via their CLI on the sandbox (each needs its binary + credentials installed there and added to <code>ACP_ALLOWED_ADAPTERS</code>). Demo is a safe no-op for testing the loop.</p>
        </div>
      )}
      <ul className="space-y-2">
        {agents.map((a) => {
          const d = draft[a.id] ?? { visibility: a.visibility, avatarUrl: a.avatarUrl ?? "" };
          return (
            <li key={a.id} className="rounded-lg border border-line bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {d.avatarUrl ? (
                      <img src={d.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated-2 text-[10px] text-ink-3">{a.handle.slice(0, 2)}</span>
                    )}
                    <span className="text-sm font-medium text-ink">{a.handle}</span>
                    <span className="rounded bg-elevated-2 px-1.5 py-0.5 text-[10px] text-ink-3">{a.adapter === "fake" ? "demo" : a.adapter}</span>
                    {a.reputation && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${a.reputation.runs === 0 ? "bg-elevated-2 text-ink-3" : a.reputation.scorePct >= 70 ? "bg-positive/10 text-positive" : a.reputation.scorePct >= 40 ? "bg-warn/10 text-warn" : "bg-danger/10 text-danger"}`} title="Reputation from verified run outcomes">
                        {a.reputation.runs === 0 ? "new" : `rep ${a.reputation.scorePct}% · ${a.reputation.runs} run${a.reputation.runs === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-3">{a.displayName}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    aria-label={`visibility for ${a.handle}`}
                    value={d.visibility}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [a.id]: { ...d, visibility: e.target.value as AgentVisibility } }))}
                    className="rounded-lg border border-line px-2 py-1 text-xs focus:border-accent focus:outline-none"
                  >
                    <option value="public">public</option>
                    <option value="private">private</option>
                  </select>
                  {getAgentSkill && (
                    <button onClick={() => openSkill(a.id)} aria-label={`skill for ${a.handle}`} className="rounded-lg border border-line px-2 py-1 text-xs text-ink-2 hover:bg-elevated-2 hover:text-ink">Skill</button>
                  )}
                  <button
                    onClick={() => save(a)}
                    aria-label={`save ${a.handle}`}
                    className="rounded-lg bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover"
                  >
                    Save
                  </button>
                </div>
              </div>
              <input
                value={d.avatarUrl}
                onChange={(e) => setDraft((prev) => ({ ...prev, [a.id]: { ...d, avatarUrl: e.target.value } }))}
                placeholder="Avatar URL"
                aria-label={`avatar url for ${a.handle}`}
                className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-xs focus:border-accent focus:outline-none"
              />
              {skillOpen === a.id && (
                <div className="mt-2 rounded-lg border border-line bg-elevated p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Skill document {skillVer > 0 ? `· v${skillVer}` : "· new"}</span>
                    <div className="flex items-center gap-1">
                      {optimizeAgentSkill && (
                        <button onClick={() => optimizeSkill(a.id)} disabled={optimizing} title="Learn from this agent's recent runs and save an improved version if it strictly beats the current one" className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-elevated-2 hover:text-ink disabled:opacity-50">{optimizing ? "Optimizing…" : "Optimize from runs"}</button>
                      )}
                      <button onClick={() => saveSkill(a.id)} className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white hover:bg-accent-hover">Save new version</button>
                    </div>
                  </div>
                  {optMsg && <div className="mb-1 text-[11px] text-ink-3">{optMsg}</div>}
                  <textarea
                    value={skillText}
                    onChange={(e) => setSkillText(e.target.value)}
                    placeholder="The agent's skill / playbook — injected into every run. Each save is a new version."
                    aria-label={`skill document for ${a.handle}`}
                    rows={4}
                    className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
