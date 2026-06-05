import { useState, type RefObject } from "react";
import type { Channel, Thread, Repo, Principal, InboxItem } from "../types.js";
import { NewThreadForm } from "./NewThreadForm.js";
import { NewDmPicker } from "./NewDmPicker.js";

// #68: the real authenticated principal shown in the sidebar footer.
export interface SidebarIdentity { userId: string; orgId: string; role?: "admin" | "member"; }

export function Sidebar({
  channels, threads, dms, principals, repos, activeThreadId,
  unreads = {}, inbox = [], onOpenInbox, identity,
  onSelectThread, onCreateThread, onCreateChannel, onStartDm, onOpenContext, canCreateChannel,
  onOpenGoals, onOpenAgents, onOpenTasks,
  newThreadRef,
}: {
  channels: Channel[];
  threads: Thread[];
  dms: Thread[];
  principals: Principal[];
  repos: Repo[];
  activeThreadId: string | null;
  unreads?: Record<string, number>;
  inbox?: InboxItem[];
  onOpenInbox?: () => void;
  identity?: SidebarIdentity | null;
  onSelectThread: (id: string) => void;
  onCreateThread: (title: string, repoId?: string) => void;
  onCreateChannel: (name: string) => void;
  onStartDm: (peerKind: "human" | "agent", peerId: string) => void;
  onOpenContext: () => void;
  canCreateChannel: boolean;
  onOpenGoals?: () => void;
  onOpenAgents?: () => void;
  onOpenTasks?: () => void;
  newThreadRef?: RefObject<HTMLInputElement>;
}) {
  const [channelName, setChannelName] = useState("");
  const createChannel = () => {
    const n = channelName.trim();
    if (!n) return;
    onCreateChannel(n);
    setChannelName("");
  };
  const threadButton = (t: Thread) => {
    const unread = unreads[t.id] ?? 0;
    return (
      <button
        key={t.id}
        onClick={() => onSelectThread(t.id)}
        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left ${t.id === activeThreadId ? "bg-[#15151f] font-medium text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
      >
        <span className={`truncate ${unread > 0 && t.id !== activeThreadId ? "font-semibold text-neutral-900" : ""}`}>{t.title}</span>
        {unread > 0 && (
          <span
            aria-label={`${unread} unread in ${t.title}`}
            className="ml-2 shrink-0 rounded-full bg-[#5b5bd6] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
          >
            {unread}
          </span>
        )}
      </button>
    );
  };
  const inboxCount = inbox.length;
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#e7e7f0] bg-white">
      <div className="px-4 py-4 text-sm font-semibold text-neutral-800">Demo Workspace</div>
      <nav className="flex-1 overflow-y-auto px-2 text-sm text-neutral-600">
        <button
          onClick={onOpenInbox}
          className="mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
        >
          <span>🔔 Activity</span>
          {inboxCount > 0 && (
            <span className="ml-2 shrink-0 rounded-full bg-[#5b5bd6] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
              {inboxCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenContext}
          className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
        >
          🧠 Context
        </button>
        {onOpenGoals && (
          <button
            onClick={onOpenGoals}
            className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
          >
            🎯 Goals
          </button>
        )}
        {onOpenAgents && (
          <button
            onClick={onOpenAgents}
            className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
          >
            🤖 Agents
          </button>
        )}
        {onOpenTasks && (
          <button
            onClick={onOpenTasks}
            className="mb-2 block w-full rounded-lg px-2 py-1.5 text-left text-neutral-600 hover:bg-neutral-100"
          >
            ✅ Tasks
          </button>
        )}
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
      <NewThreadForm repos={repos} onCreate={onCreateThread} inputRef={newThreadRef} />
      <div className="px-4 py-3 text-xs text-neutral-400">
        {identity
          ? <>signed in as {identity.userId} · org {identity.orgId}{identity.role ? ` · ${identity.role}` : ""}</>
          : <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">dev (no session)</span>}
      </div>
    </aside>
  );
}
