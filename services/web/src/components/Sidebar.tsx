import { useState } from "react";
import type { Channel, Thread, Repo, Principal } from "../types.js";
import { NewThreadForm } from "./NewThreadForm.js";
import { NewDmPicker } from "./NewDmPicker.js";

export function Sidebar({
  channels, threads, dms, principals, repos, activeThreadId,
  onSelectThread, onCreateThread, onCreateChannel, onStartDm, canCreateChannel,
}: {
  channels: Channel[];
  threads: Thread[];
  dms: Thread[];
  principals: Principal[];
  repos: Repo[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onCreateThread: (title: string, repoId?: string) => void;
  onCreateChannel: (name: string) => void;
  onStartDm: (peerKind: "human" | "agent", peerId: string) => void;
  canCreateChannel: boolean;
}) {
  const [channelName, setChannelName] = useState("");
  const createChannel = () => {
    const n = channelName.trim();
    if (!n) return;
    onCreateChannel(n);
    setChannelName("");
  };
  const threadButton = (t: Thread) => (
    <button
      key={t.id}
      onClick={() => onSelectThread(t.id)}
      className={`block w-full rounded-lg px-2 py-1.5 text-left ${t.id === activeThreadId ? "bg-[#15151f] font-medium text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
    >
      {t.title}
    </button>
  );
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#e7e7f0] bg-white">
      <div className="px-4 py-4 text-sm font-semibold text-neutral-800">Demo Workspace</div>
      <nav className="flex-1 overflow-y-auto px-2 text-sm text-neutral-600">
        {channels.map((c) => (
          <div key={c.id} className="mb-2">
            <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400"># {c.name}</div>
            {threads.filter((t) => t.channelId === c.id).map(threadButton)}
          </div>
        ))}
        <div className="mb-2">
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Direct Messages</div>
          {dms.map(threadButton)}
          <NewDmPicker principals={principals} onStartDm={onStartDm} />
        </div>
      </nav>
      {canCreateChannel && (
        <div className="flex gap-1 px-3 pt-2">
          <input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createChannel(); }}
            placeholder="New channel"
            className="min-w-0 flex-1 rounded-lg border border-[#e7e7f0] px-2 py-1 text-xs focus:border-neutral-800 focus:outline-none"
          />
          <button onClick={createChannel} aria-label="create channel" className="rounded-lg bg-[#15151f] px-2 text-sm text-white hover:bg-black">+</button>
        </div>
      )}
      <NewThreadForm repos={repos} onCreate={onCreateThread} />
      <div className="px-4 py-3 text-xs text-neutral-400">signed in as m1 · org o1 (dev stub)</div>
    </aside>
  );
}
