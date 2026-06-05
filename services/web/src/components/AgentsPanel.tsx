import { useEffect, useState } from "react";
import type { Agent, AgentVisibility } from "../api.js";

// #58/#91 agents panel: list the org's agents and edit each one's profile
// (visibility public|private + optional avatar URL) via PATCH /agents/:id/profile.
// There is no set-model route, so the model/adapter is shown read-only.
export function AgentsPanel({
  listAgents,
  setAgentProfile,
}: {
  listAgents: () => Promise<Agent[]>;
  setAgentProfile: (agentId: string, patch: { avatarUrl?: string | null; visibility?: AgentVisibility }) => Promise<Agent>;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [draft, setDraft] = useState<Record<string, { visibility: AgentVisibility; avatarUrl: string }>>({});
  const [error, setError] = useState<string | null>(null);

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
      <h2 className="mb-4 text-sm font-semibold text-neutral-800">Agents</h2>
      {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
      <ul className="space-y-2">
        {agents.map((a) => {
          const d = draft[a.id] ?? { visibility: a.visibility, avatarUrl: a.avatarUrl ?? "" };
          return (
            <li key={a.id} className="rounded-lg border border-[#e7e7f0] bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {d.avatarUrl ? (
                      <img src={d.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[10px] text-neutral-500">{a.handle.slice(0, 2)}</span>
                    )}
                    <span className="text-sm font-medium text-neutral-800">{a.handle}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">{a.adapter}</span>
                  </div>
                  <div className="text-xs text-neutral-400">{a.displayName}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    aria-label={`visibility for ${a.handle}`}
                    value={d.visibility}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [a.id]: { ...d, visibility: e.target.value as AgentVisibility } }))}
                    className="rounded-lg border border-[#e7e7f0] px-2 py-1 text-xs focus:border-neutral-800 focus:outline-none"
                  >
                    <option value="public">public</option>
                    <option value="private">private</option>
                  </select>
                  <button
                    onClick={() => save(a)}
                    aria-label={`save ${a.handle}`}
                    className="rounded-lg bg-[#15151f] px-2 py-1 text-xs text-white hover:bg-black"
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
                className="mt-2 w-full rounded-lg border border-[#e7e7f0] px-2 py-1 text-xs focus:border-neutral-800 focus:outline-none"
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
