import { useState, type RefObject } from "react";
import type { Channel, Thread, Repo, Principal, InboxItem } from "../types.js";
import { NewThreadForm } from "./NewThreadForm.js";
import { NewDmPicker } from "./NewDmPicker.js";
import { Icon } from "./Icon.js";

// #68: the real authenticated principal shown in the sidebar footer.
export interface SidebarIdentity { userId: string; orgId: string; role?: "admin" | "member"; }

export function Sidebar({
  channels, threads, dms, principals, repos, activeThreadId,
  unreads = {}, identity,
  onSelectThread, onCreateThread, onCreateChannel, onStartDm, canCreateChannel,
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
  onOpenContext?: () => void;
  canCreateChannel: boolean;
  onOpenGoals?: () => void;
  onOpenAgents?: () => void;
  onOpenTasks?: () => void;
  onOpenBilling?: () => void;
  onOpenAutomations?: () => void;
  onOpenMemory?: () => void;
  newThreadRef?: RefObject<HTMLInputElement>;
}) {
  const [channelName, setChannelName] = useState("");
  const [query, setQuery] = useState("");
  const createChannel = () => {
    const n = channelName.trim();
    if (!n) return;
    onCreateChannel(n);
    setChannelName("");
  };
  const q = query.trim().toLowerCase();
  const matches = (t: Thread) => !q || t.title.toLowerCase().includes(q);

  const threadButton = (t: Thread) => {
    const unread = unreads[t.id] ?? 0;
    const active = t.id === activeThreadId;
    return (
      <button
        key={t.id}
        onClick={() => onSelectThread(t.id)}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left text-[13px] transition-colors ${
          active ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-elevated hover:text-ink"
        }`}
      >
        <span className={`truncate ${unread > 0 && !active ? "font-semibold text-ink" : ""}`}>{t.title}</span>
        {unread > 0 && (
          <span
            aria-label={`${unread} unread in ${t.title}`}
            className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
          >
            {unread}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      {/* Workspace header */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="text-[13px] font-semibold text-ink">Demo Workspace</div>
      </div>

      {/* Channel filter */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-2.5 py-1.5">
          <Icon name="search" size={14} className="text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {channels.map((c) => {
          const list = threads.filter((t) => t.channelId === c.id).filter(matches);
          return (
            <div key={c.id} className="pt-2">
              <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3"># {c.name}</div>
              <div className="space-y-0.5">{list.map(threadButton)}</div>
            </div>
          );
        })}

        <div className="pt-2">
          <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Direct Messages</div>
          <div className="space-y-0.5">{dms.filter(matches).map(threadButton)}</div>
          <NewDmPicker principals={principals} onStartDm={onStartDm} />
        </div>
      </nav>

      {canCreateChannel && (
        <div className="flex gap-1.5 border-t border-line-soft px-3 pt-2.5">
          <input
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createChannel(); }}
            placeholder="New channel"
            className="min-w-0 flex-1 rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <button onClick={createChannel} aria-label="create channel" className="flex items-center justify-center rounded-lg bg-elevated px-2 text-ink-2 transition-colors hover:bg-elevated-2 hover:text-ink"><Icon name="plus" size={15} /></button>
        </div>
      )}
      <NewThreadForm repos={repos} onCreate={onCreateThread} inputRef={newThreadRef} />

      <div className="border-t border-line-soft px-3 py-3 text-[11px] text-ink-3">
        {identity
          ? <>signed in as {identity.userId} · org {identity.orgId}{identity.role ? ` · ${identity.role}` : ""}</>
          : <span className="rounded bg-warn-soft px-1.5 py-0.5 font-medium text-warn">dev (no session)</span>}
      </div>
    </aside>
  );
}
