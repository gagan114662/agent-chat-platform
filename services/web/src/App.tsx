import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ThreadView } from "./components/ThreadView.js";
import { Composer } from "./components/Composer.js";
import { useThreadStream } from "./useThreadStream.js";
import { listChannels, listThreads, listRepos, createThread } from "./api.js";
import type { Channel, Thread, Repo } from "./types.js";

export function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Load channels + repos once, then threads for each channel.
  useEffect(() => {
    (async () => {
      const [chs, rps] = await Promise.all([listChannels(), listRepos()]);
      setChannels(chs);
      setRepos(rps);
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
    setActiveThreadId(t.id);
  };

  return (
    <div className="flex h-screen bg-white text-slate-900">
      <Sidebar
        channels={channels}
        threads={threads}
        repos={repos}
        activeThreadId={activeThreadId}
        onSelectThread={setActiveThreadId}
        onCreateThread={onCreateThread}
      />
      <main className="flex flex-1 flex-col">
        <header className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-700">
            {threads.find((t) => t.id === activeThreadId)?.title ?? "No thread selected"}
          </h1>
          <p className="text-xs text-slate-400">chat → sandboxed agent → PR → back to chat</p>
        </header>
        {activeThreadId
          ? <ThreadConversation threadId={activeThreadId} />
          : <div className="flex-1" />}
      </main>
    </div>
  );
}

// Separate component so the stream hook re-subscribes when the active thread changes.
function ThreadConversation({ threadId }: { threadId: string }) {
  const { messages, send } = useThreadStream(threadId);
  return (
    <>
      <ThreadView messages={messages} />
      <Composer onSend={send} />
    </>
  );
}
