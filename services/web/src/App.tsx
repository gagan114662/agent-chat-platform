import { Sidebar } from "./components/Sidebar.js";
import { ThreadView } from "./components/ThreadView.js";
import { Composer } from "./components/Composer.js";
import { useThreadStream } from "./useThreadStream.js";

const THREAD_ID = "t1"; // the seeded demo thread (Phase 2.1 adds navigation)

export function App() {
  const { messages, send } = useThreadStream(THREAD_ID);
  return (
    <div className="flex h-screen bg-white text-slate-900">
      <Sidebar />
      <main className="flex flex-1 flex-col">
        <header className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-700">Demo thread</h1>
          <p className="text-xs text-slate-400">chat → sandboxed agent → PR → back to chat</p>
        </header>
        <ThreadView messages={messages} />
        <Composer onSend={send} />
      </main>
    </div>
  );
}
