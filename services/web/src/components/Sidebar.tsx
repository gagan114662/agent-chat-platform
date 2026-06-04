import type { Channel, Thread, Repo } from "../types.js";
import { NewThreadForm } from "./NewThreadForm.js";

export function Sidebar({
  channels, threads, repos, activeThreadId, onSelectThread, onCreateThread,
}: {
  channels: Channel[];
  threads: Thread[];
  repos: Repo[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onCreateThread: (title: string, repoId?: string) => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="px-4 py-4 text-sm font-semibold text-slate-700">Demo Workspace</div>
      <nav className="flex-1 overflow-y-auto px-2 text-sm text-slate-600">
        {channels.map((c) => (
          <div key={c.id} className="mb-2">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400"># {c.name}</div>
            {threads.filter((t) => t.channelId === c.id).map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectThread(t.id)}
                className={`block w-full rounded-md px-2 py-1.5 text-left ${t.id === activeThreadId ? "bg-indigo-100 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {t.title}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <NewThreadForm repos={repos} onCreate={onCreateThread} />
      <div className="px-4 py-3 text-xs text-slate-400">signed in as m1 · org o1 (dev stub)</div>
    </aside>
  );
}
