import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ThreadView } from "./components/ThreadView.js";
import { Composer } from "./components/Composer.js";
import { SearchBar } from "./components/SearchBar.js";
import { ContextExplorer } from "./components/ContextExplorer.js";
import { useThreadStream } from "./useThreadStream.js";
import { useMemory } from "./useMemory.js";
import { listChannels, listThreads, listRepos, createThread, createChannel, searchMessages, listPrincipals, listDms, startDm, approveRun, declineRun } from "./api.js";
import type { Channel, Thread, Repo, Principal } from "./types.js";
import { useAuth } from "./useAuth.js";
import { LoginScreen } from "./components/LoginScreen.js";

export function App() {
  const { principal, loading, login, logout } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-neutral-400">Loading…</div>;
  if (!principal) return <LoginScreen onLogin={login} />;
  return <Workspace onLogout={logout} userId={principal.userId} role={principal.role ?? "member"} />;
}

function Workspace({ onLogout, userId, role }: { onLogout: () => void; userId: string; role: "admin" | "member" }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [dms, setDms] = useState<Thread[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [view, setView] = useState<"thread" | "context">("thread");
  const memory = useMemory();

  const selectThread = (id: string) => { setActiveThreadId(id); setView("thread"); };

  // Load channels + repos once, then threads for each channel.
  useEffect(() => {
    (async () => {
      const [chs, rps, ps, dmList] = await Promise.all([listChannels(), listRepos(), listPrincipals(), listDms()]);
      setChannels(chs);
      setRepos(rps);
      setPrincipals(ps);
      setDms(dmList);
      const all = (await Promise.all(chs.map((c) => listThreads(c.id)))).flat();
      setThreads(all);
      setActiveThreadId((cur) => cur ?? all[0]?.id ?? null);
    })().catch(() => {});
  }, []);

  const onCreateThread = async (title: string, repoId?: string) => {
    const channelId = channels[0]?.id;
    if (!channelId) return;
    const t = await createThread(channelId, { title, repoId });
    setThreads((prev) => [t, ...prev]);
    selectThread(t.id);
  };

  const onCreateChannel = async (name: string) => {
    const c = await createChannel(name);
    setChannels((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const onStartDm = async (peerKind: "human" | "agent", peerId: string) => {
    const t = await startDm(peerKind, peerId);
    setDms((prev) => prev.some((d) => d.id === t.id) ? prev : [t, ...prev]);
    selectThread(t.id);
  };

  return (
    <div className="flex h-screen bg-[#f0f0f7] text-[#2b2b2b]">
      <Sidebar
        channels={channels}
        threads={threads}
        dms={dms}
        principals={principals}
        repos={repos}
        activeThreadId={activeThreadId}
        onSelectThread={selectThread}
        onCreateThread={onCreateThread}
        onCreateChannel={onCreateChannel}
        onStartDm={onStartDm}
        onOpenContext={() => setView("context")}
        canCreateChannel={role === "admin"}
      />
      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[#e7e7f0] bg-white px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold text-neutral-800">
              {view === "context"
                ? "Context Explorer"
                : ([...threads, ...dms].find((t) => t.id === activeThreadId)?.title ?? "No thread selected")}
            </h1>
            <p className="text-xs text-neutral-400">chat → sandboxed agent → PR → back to chat</p>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar onSearch={searchMessages} onSelect={setActiveThreadId} />
            <button onClick={onLogout} className="text-xs text-neutral-500 hover:text-neutral-800">Sign out ({userId})</button>
          </div>
        </header>
        {view === "context"
          ? <ContextExplorer
              graph={memory.graph}
              stats={memory.stats}
              scope={memory.scope}
              onScopeChange={memory.setScope}
              kind={memory.kind}
              onKindChange={memory.setKind}
              loading={memory.loading}
            />
          : activeThreadId
            ? <ThreadConversation threadId={activeThreadId} />
            : <div className="flex-1" />}
      </main>
    </div>
  );
}

// Separate component so the stream hook re-subscribes when the active thread changes.
function ThreadConversation({ threadId }: { threadId: string }) {
  const { messages, send, refetch } = useThreadStream(threadId);
  const onApprove = (runId: string) => { approveRun(runId).then(refetch).catch(() => {}); };
  const onDecline = (runId: string) => { declineRun(runId).then(refetch).catch(() => {}); };
  return (
    <>
      <ThreadView messages={messages} onApprove={onApprove} onDecline={onDecline} />
      <Composer onSend={send} />
    </>
  );
}
