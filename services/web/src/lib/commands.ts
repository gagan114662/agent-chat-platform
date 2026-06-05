// Shared command registry (#60). Drives both the ⌘K palette and composer slash
// commands. A command maps an id/title/keywords to a `run` that calls a real App
// action — no backend wiring here.
export type Command = {
  id: string;
  title: string;
  keywords?: string;
  run: () => void;
};

// App actions the registry can invoke. These mirror existing Workspace handlers.
export interface CommandActions {
  selectChannel: (channelId: string) => void;
  selectThread: (threadId: string) => void;
  openNewThread: () => void;
  openNewDm: () => void;
  openInbox: () => void;
  openGoals: () => void;
  openAgents: () => void;
  openTasks: () => void;
  openBilling: () => void;
  openAutomations: () => void;
  openMemory: () => void;
  // `query` is used by the `/search <q>` slash command; the ⌘K entry passes none.
  focusSearch: (query?: string) => void;
}

export interface CommandContext {
  channels: { id: string; name: string }[];
  threads: { id: string; title: string }[];
  actions: CommandActions;
}

// Case-insensitive filter over title+keywords, ranked: title-prefix first, then
// word-start match, then any substring match. Empty query returns all (in order).
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const scored: { cmd: Command; score: number }[] = [];
  for (const cmd of commands) {
    const title = cmd.title.toLowerCase();
    const hay = `${title} ${(cmd.keywords ?? "").toLowerCase()}`;
    if (!hay.includes(q)) continue;
    let score = 3; // any substring match
    if (wordStart(hay, q)) score = 2; // match at a word boundary
    if (title.startsWith(q)) score = 1; // title prefix wins
    scored.push({ cmd, score });
  }
  // Stable sort by ascending score (lower = better), preserving input order on ties.
  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((s) => s.cmd);
}

function wordStart(haystack: string, q: string): boolean {
  let idx = haystack.indexOf(q);
  while (idx !== -1) {
    if (idx === 0 || /\W/.test(haystack[idx - 1])) return true;
    idx = haystack.indexOf(q, idx + 1);
  }
  return false;
}

// Factory: given nav context + App actions, produce the full command list.
export function buildCommands(ctx: CommandContext): Command[] {
  const { channels, threads, actions } = ctx;
  const commands: Command[] = [];
  for (const c of channels) {
    commands.push({
      id: `channel:${c.id}`,
      title: `Go to #${c.name}`,
      keywords: "channel navigate",
      run: () => actions.selectChannel(c.id),
    });
  }
  for (const t of threads) {
    commands.push({
      id: `thread:${t.id}`,
      title: `Go to ${t.title}`,
      keywords: "thread navigate",
      run: () => actions.selectThread(t.id),
    });
  }
  commands.push(
    { id: "new-thread", title: "New thread", keywords: "create thread", run: () => actions.openNewThread() },
    { id: "new-dm", title: "New DM", keywords: "direct message dm", run: () => actions.openNewDm() },
    { id: "inbox", title: "Open Activity (inbox)", keywords: "notifications mentions activity", run: () => actions.openInbox() },
    { id: "goals", title: "Open Goals", keywords: "goals autonomy tick decompose", run: () => actions.openGoals() },
    { id: "agents", title: "Open Agents", keywords: "agents visibility avatar profile", run: () => actions.openAgents() },
    { id: "tasks", title: "Open Tasks", keywords: "tasks task detail comments", run: () => actions.openTasks() },
    { id: "billing", title: "Open Billing", keywords: "billing plan usage quota upgrade subscription", run: () => actions.openBilling() },
    { id: "automations", title: "Open Automations", keywords: "automations schedule event trigger action", run: () => actions.openAutomations() },
    { id: "memory", title: "Open Memory", keywords: "memory recall consolidate dream nodes context", run: () => actions.openMemory() },
    { id: "search", title: "Search messages…", keywords: "find search", run: () => actions.focusSearch() },
  );
  return commands;
}
