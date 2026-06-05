import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { buildCommands, type Command } from "./lib/commands.js";
import { ThreadView } from "./components/ThreadView.js";
import { Composer } from "./components/Composer.js";
import { SearchBar } from "./components/SearchBar.js";
import { ContextExplorer } from "./components/ContextExplorer.js";
import { useThreadStream } from "./useThreadStream.js";
import { useMemory } from "./useMemory.js";
import { listChannels, listThreads, listRepos, createThread, createChannel, searchMessages, listPrincipals, listDms, startDm, approveRun, declineRun, runDiff, runFile, syncPrComments, updatePr, listCheckpoints, restoreCheckpoint, approvePlan, rejectPlan, getUnreads, markThreadRead, getInbox, createGoal, decomposeGoal, runTick, listAgents, setAgentProfile, getTask, updateTask, addTaskComment, getBilling, listPlans, billingCheckout, listAutomations, createAutomation, setAutomationEnabled, deleteAutomation, memoryRecall, memoryConsolidate, listMemoryNodes } from "./api.js";
import { GoalsPanel } from "./components/GoalsPanel.js";
import { AgentsPanel } from "./components/AgentsPanel.js";
import { TasksPanel } from "./components/TasksPanel.js";
import { BillingPanel } from "./components/BillingPanel.js";
import { AutomationsPanel } from "./components/AutomationsPanel.js";
import { MemoryPanel } from "./components/MemoryPanel.js";
import type { Channel, Thread, Repo, Principal, InboxItem } from "./types.js";
import { useAuth } from "./useAuth.js";
import { useTheme } from "./useTheme.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { Icon } from "./components/Icon.js";
import { WorkspaceRail } from "./components/WorkspaceRail.js";
import { TeamPanel } from "./components/TeamPanel.js";

export function App() {
  const { principal, loading, login, logout } = useAuth();
  const theme = useTheme(); // applied globally (incl. login screen) via html.theme-light
  if (loading) return <div className="flex h-screen items-center justify-center bg-app text-sm text-ink-3">Loading…</div>;
  if (!principal) return <LoginScreen onLogin={login} />;
  return <Workspace onLogout={logout} userId={principal.userId} orgId={principal.orgId} role={principal.role ?? "member"} theme={theme.theme} onToggleTheme={theme.toggle} />;
}

function Workspace({ onLogout, userId, orgId, role, theme, onToggleTheme }: { onLogout: () => void; userId: string; orgId: string; role: "admin" | "member"; theme: "dark" | "light"; onToggleTheme: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [dms, setDms] = useState<Thread[]>([]);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [view, setView] = useState<"thread" | "context" | "inbox" | "goals" | "agents" | "tasks" | "billing" | "automations" | "memory">("thread");
  const [unreads, setUnreads] = useState<Record<string, number>>({});
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState<{ q: string; nonce: number } | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const memory = useMemory();

  // #61: refetch unread counts + mentions inbox (on mount, after WS messages, after mark-read).
  const refreshNotifications = useCallback(() => {
    Promise.all([getUnreads(), getInbox()]).then(([u, ib]) => {
      setUnreads(Object.fromEntries(u.map((c) => [c.threadId, c.unread])));
      setInbox(ib);
    }).catch(() => {});
  }, []);

  // Opening a thread marks it read, optimistically clears its badge, then refetches.
  const selectThread = (id: string) => {
    setActiveThreadId(id);
    setView("thread");
    setUnreads((prev) => { const next = { ...prev }; delete next[id]; return next; });
    markThreadRead(id).then(refreshNotifications).catch(() => {});
  };

  // Navigating to a channel selects its first thread (no dedicated channel view exists).
  const selectChannel = (channelId: string) => {
    const first = threads.find((t) => t.channelId === channelId);
    if (first) selectThread(first.id);
  };

  // Focus the header search input (used by the "Search messages…" command + /search).
  // A query (from `/search <q>`) is pushed through state so SearchBar runs it.
  const focusSearch = (query?: string) => {
    searchRef.current?.focus();
    // Bump a nonce so SearchBar re-runs even when the same query repeats.
    if (query) setSearch((prev) => ({ q: query, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // ⌘K / Ctrl+K toggles the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    refreshNotifications();
  }, [refreshNotifications]);

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

  // Build the command registry from current nav state + the real App actions.
  // New thread/DM are created via inline Sidebar forms (no programmatic modal),
  // so those commands focus the sidebar's "New thread" input as the closest action.
  const newThreadRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(
    () => buildCommands({
      channels: channels.map((c) => ({ id: c.id, name: c.name })),
      threads: [...threads, ...dms].map((t) => ({ id: t.id, title: t.title })),
      actions: {
        selectChannel,
        selectThread,
        openNewThread: () => newThreadRef.current?.focus(),
        openNewDm: () => newThreadRef.current?.focus(),
        openInbox: () => setView("inbox"),
        openGoals: () => setView("goals"),
        openAgents: () => setView("agents"),
        openTasks: () => setView("tasks"),
        openBilling: () => setView("billing"),
        openAutomations: () => setView("automations"),
        openMemory: () => setView("memory"),
        focusSearch,
      },
    }),
    // selectChannel/selectThread close over `threads`; rebuild when nav state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, threads, dms],
  );

  return (
    <div className="flex h-screen bg-app text-ink">
      <WorkspaceRail
        active={view === "inbox" ? "activity" : view}
        inboxCount={inbox.length}
        onSelect={{
          activity: () => setView("inbox"),
          context: () => setView("context"),
          memory: () => setView("memory"),
          goals: () => setView("goals"),
          agents: () => setView("agents"),
          tasks: () => setView("tasks"),
          automations: () => setView("automations"),
          billing: () => setView("billing"),
        }}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <Sidebar
        channels={channels}
        threads={threads}
        dms={dms}
        principals={principals}
        repos={repos}
        activeThreadId={activeThreadId}
        unreads={unreads}
        inbox={inbox}
        onOpenInbox={() => setView("inbox")}
        onSelectThread={selectThread}
        onCreateThread={onCreateThread}
        onCreateChannel={onCreateChannel}
        onStartDm={onStartDm}
        onOpenContext={() => setView("context")}
        canCreateChannel={role === "admin"}
        identity={{ userId, orgId, role }}
        onOpenGoals={() => setView("goals")}
        onOpenAgents={() => setView("agents")}
        onOpenTasks={() => setView("tasks")}
        onOpenBilling={() => setView("billing")}
        onOpenAutomations={() => setView("automations")}
        onOpenMemory={() => setView("memory")}
        newThreadRef={newThreadRef}
      />
      <main className="flex flex-1 flex-col bg-surface-2">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
          <div>
            <h1 className="text-[14px] font-semibold text-ink">
              {view === "context"
                ? "Context Explorer"
                : view === "inbox"
                  ? "Activity"
                  : view === "goals"
                    ? "Goals"
                    : view === "agents"
                      ? "Agents"
                      : view === "tasks"
                        ? "Tasks"
                        : view === "billing"
                          ? "Billing"
                          : view === "automations"
                            ? "Automations"
                            : view === "memory"
                              ? "Memory"
                              : ([...threads, ...dms].find((t) => t.id === activeThreadId)?.title ?? "No thread selected")}
            </h1>
            <p className="text-[11px] text-ink-3">{{
              context: "Knowledge graph of decisions, facts & artifacts",
              inbox: "Mentions, approvals & failed runs",
              goals: "State a goal; agents decompose & execute it",
              agents: "The AI agents in this workspace",
              tasks: "Work items across humans & agents",
              billing: "Plan, usage & quotas",
              automations: "Scheduled & event-driven agent runs",
              memory: "Search & consolidate workspace memory",
              thread: "chat → sandboxed agent → PR → back to chat",
            }[view] ?? "chat → sandboxed agent → PR → back to chat"}</p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBar key={search?.nonce ?? 0} onSearch={searchMessages} onSelect={setActiveThreadId} inputRef={searchRef} initialQuery={search?.q} />
            <button onClick={onLogout} title={`Sign out (${userId})`} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-ink-3 transition-colors hover:bg-elevated hover:text-ink">
              <Icon name="logout" size={14} /> Sign out
            </button>
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
          : view === "inbox"
            ? <InboxPanel inbox={inbox} onSelect={selectThread} />
            : view === "goals"
              ? <GoalsPanel orgId={orgId} createGoal={createGoal} decomposeGoal={decomposeGoal} runTick={runTick} />
              : view === "agents"
                ? <AgentsPanel listAgents={listAgents} setAgentProfile={setAgentProfile} />
                : view === "tasks"
                  ? <TasksPanel getTask={getTask} updateTask={updateTask} addTaskComment={addTaskComment} />
                  : view === "billing"
                    ? <BillingPanel getBilling={getBilling} listPlans={listPlans} billingCheckout={billingCheckout} />
                    : view === "automations"
                      ? <AutomationsPanel listAutomations={listAutomations} createAutomation={createAutomation} setAutomationEnabled={setAutomationEnabled} deleteAutomation={deleteAutomation} />
                      : view === "memory"
                        ? <MemoryPanel memoryRecall={memoryRecall} memoryConsolidate={memoryConsolidate} listMemoryNodes={listMemoryNodes} />
                        : activeThreadId
                    ? <ThreadConversation threadId={activeThreadId} onActivity={refreshNotifications} commands={commands} onSlashSearch={focusSearch} />
                    : <div className="flex-1" />}
      </main>
      <TeamPanel principals={principals} onStartDm={onStartDm} />
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

// Lists threads where you were @mentioned and haven't read since (#61).
function InboxPanel({ inbox, onSelect }: { inbox: InboxItem[]; onSelect: (id: string) => void }) {
  return (
    <div className="flex-1 overflow-y-auto bg-surface-2 p-4">
      {inbox.length === 0 ? (
        <p className="text-sm text-ink-3">Nothing new. You're all caught up.</p>
      ) : (
        <ul className="mx-auto max-w-2xl space-y-2">
          {inbox.map((i) => (
            <li key={i.threadId}>
              <button
                onClick={() => onSelect(i.threadId)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-accent/50 hover:bg-elevated"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon name="activity" size={15} /></span>
                <span className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{i.title}</div>
                  <div className="text-xs text-ink-3">you were mentioned</div>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Separate component so the stream hook re-subscribes when the active thread changes.
function ThreadConversation({ threadId, onActivity, commands, onSlashSearch }: { threadId: string; onActivity?: () => void; commands?: Command[]; onSlashSearch?: (q: string) => void }) {
  const { messages, send, refetch } = useThreadStream(threadId, onActivity);
  const onApprove = (runId: string) => { approveRun(runId).then(refetch).catch(() => {}); };
  const onDecline = (runId: string) => { declineRun(runId).then(refetch).catch(() => {}); };
  const onLoadDiff = (runId: string) => runDiff(runId);
  const onOpenFile = (runId: string, path: string) => runFile(runId, path);
  // Synced comments also arrive via WS, but refetch covers the no-socket case.
  const onSyncComments = (runId: string) => { syncPrComments(runId).then(refetch).catch(() => {}); };
  const onUpdatePr = (runId: string, patch: { title?: string; body?: string; base?: string }) => { updatePr(runId, patch).then(refetch).catch(() => {}); };
  const onLoadCheckpoints = (runId: string) => listCheckpoints(runId);
  // Restore opens a new run; refetch picks up the "restored from checkpoint" message.
  const onRestoreCheckpoint = (runId: string, cpId: string) => { restoreCheckpoint(runId, cpId).then(refetch).catch(() => {}); };
  const onApprovePlan = (runId: string) => { approvePlan(runId).then(refetch).catch(() => {}); };
  const onRejectPlan = (runId: string, notes?: string) => { rejectPlan(runId, notes).then(refetch).catch(() => {}); };
  return (
    <>
      <ThreadView messages={messages} onApprove={onApprove} onDecline={onDecline} onLoadDiff={onLoadDiff} onOpenFile={onOpenFile} onSyncComments={onSyncComments} onUpdatePr={onUpdatePr} onLoadCheckpoints={onLoadCheckpoints} onRestoreCheckpoint={onRestoreCheckpoint} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} />
      <Composer onSend={send} commands={commands} onSlashSearch={onSlashSearch} />
    </>
  );
}
