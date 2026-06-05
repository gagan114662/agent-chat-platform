import type { Message, Channel, Thread, Repo, SearchResult, Principal, MemoryGraph, MemoryStats, MemoryKind, MemoryScope, ChangedFile, Checkpoint, UnreadCount, InboxItem } from "./types.js";
import { authHeaders } from "./auth.js";

// Fetches a short-lived single-use WS ticket so the token never rides in the WS URL.
// Returns null on any non-2xx (e.g. dev/no-session) so the WS still opens token-free.
export async function getWsTicket(): Promise<string | null> {
  const res = await fetch(`/ws-ticket`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) return null;
  const { ticket } = (await res.json()) as { ticket?: string };
  return ticket ?? null;
}

export async function listMessages(threadId: string): Promise<Message[]> {
  const res = await fetch(`/threads/${threadId}/messages`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listMessages ${res.status}`);
  return res.json();
}

export async function postMessage(threadId: string, body: string): Promise<{ message: Message; startedRuns: string[] }> {
  const res = await fetch(`/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`postMessage ${res.status}`);
  return res.json();
}

export async function approveRun(runId: string): Promise<void> {
  const res = await fetch(`/runs/${runId}/approve`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`approveRun ${res.status}`);
}

export async function declineRun(runId: string): Promise<void> {
  const res = await fetch(`/runs/${runId}/decline`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`declineRun ${res.status}`);
}

export async function approvePlan(runId: string): Promise<void> {
  const res = await fetch(`/runs/${runId}/approve-plan`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`approvePlan ${res.status}`);
}

export async function rejectPlan(runId: string, notes?: string): Promise<void> {
  const res = await fetch(`/runs/${runId}/reject-plan`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error(`rejectPlan ${res.status}`);
}

export async function runDiff(runId: string): Promise<ChangedFile[]> {
  const res = await fetch(`/runs/${runId}/diff`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`runDiff ${res.status}`);
  return res.json();
}

export interface FileContent {
  content: string;
  encoding: "utf8" | "base64";
  size: number;
}

export async function runFile(runId: string, path: string): Promise<FileContent> {
  const res = await fetch(`/runs/${runId}/file?path=${encodeURIComponent(path)}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`runFile ${res.status}`);
  return res.json();
}

export async function syncPrComments(runId: string): Promise<{ synced: number }> {
  const res = await fetch(`/runs/${runId}/sync-comments`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`syncPrComments ${res.status}`);
  return res.json();
}

export async function updatePr(runId: string, patch: { title?: string; body?: string; base?: string }): Promise<{ ok: boolean }> {
  const res = await fetch(`/runs/${runId}/update-pr`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updatePr ${res.status}`);
  return res.json();
}

// #62 checkpoints: list a run's commit snapshots.
export async function listCheckpoints(runId: string): Promise<Checkpoint[]> {
  const res = await fetch(`/runs/${runId}/checkpoints`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listCheckpoints ${res.status}`);
  const { checkpoints } = (await res.json()) as { checkpoints: Checkpoint[] };
  return checkpoints;
}

// #62 checkpoints: restore (rewind) = open a new run from the checkpoint commit.
export async function restoreCheckpoint(runId: string, cpId: string): Promise<{ run: { id: string } }> {
  const res = await fetch(`/runs/${runId}/checkpoints/${cpId}/restore`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`restoreCheckpoint ${res.status}`);
  return res.json();
}

// #64 concurrent runs: fan a task out to N agents — starts one concurrent run per
// agent. Returns the created run ids.
export async function fanOutTask(taskId: string, agentIds: string[]): Promise<{ runs: string[] }> {
  const res = await fetch(`/tasks/${taskId}/fan-out`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ agentIds }),
  });
  if (!res.ok) throw new Error(`fanOutTask ${res.status}`);
  return res.json();
}

// #64 concurrent runs: a run competing on a task (sibling list shape).
export interface TaskRun {
  id: string;
  state: string;
  prNumber?: number | null;
  prUrl?: string | null;
  selected: boolean;
}

// #64 concurrent runs: list the runs competing on one task (siblings).
export async function taskRuns(taskId: string): Promise<TaskRun[]> {
  const res = await fetch(`/tasks/${taskId}/runs`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`taskRuns ${res.status}`);
  const { runs } = (await res.json()) as { runs: TaskRun[] };
  return runs;
}

// #64 concurrent runs: mark a run the winner among its task's siblings (exclusive).
export async function selectRun(runId: string): Promise<{ run: TaskRun }> {
  const res = await fetch(`/runs/${runId}/select`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`selectRun ${res.status}`);
  return res.json();
}

export async function listChannels(): Promise<Channel[]> {
  const res = await fetch(`/channels`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listChannels ${res.status}`);
  return res.json();
}

export async function listThreads(channelId: string): Promise<Thread[]> {
  const res = await fetch(`/channels/${channelId}/threads`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listThreads ${res.status}`);
  return res.json();
}

export async function createThread(channelId: string, input: { title: string; repoId?: string }): Promise<Thread> {
  const res = await fetch(`/channels/${channelId}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createThread ${res.status}`);
  return res.json();
}

export async function listRepos(): Promise<Repo[]> {
  const res = await fetch(`/repos`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listRepos ${res.status}`);
  return res.json();
}

export async function createChannel(name: string): Promise<Channel> {
  const res = await fetch(`/channels`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createChannel ${res.status}`);
  return res.json();
}

export async function searchMessages(q: string): Promise<SearchResult[]> {
  const res = await fetch(`/search?q=${encodeURIComponent(q)}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`searchMessages ${res.status}`);
  return res.json();
}

export async function listPrincipals(): Promise<Principal[]> {
  const res = await fetch(`/principals`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listPrincipals ${res.status}`);
  return res.json();
}

export async function listDms(): Promise<Thread[]> {
  const res = await fetch(`/dms`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listDms ${res.status}`);
  return res.json();
}

export async function startDm(peerKind: "human" | "agent", peerId: string): Promise<Thread> {
  const res = await fetch(`/dms`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ peerKind, peerId }),
  });
  if (!res.ok) throw new Error(`startDm ${res.status}`);
  return res.json();
}

export async function memoryGraph(filter: { kind?: MemoryKind; scope?: MemoryScope } = {}): Promise<MemoryGraph> {
  const qs = new URLSearchParams();
  if (filter.kind) qs.set("kind", filter.kind);
  if (filter.scope) qs.set("scope", filter.scope);
  const res = await fetch(`/memory/graph?${qs}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryGraph ${res.status}`);
  return res.json();
}

// #61 notifications: per-user unread counts, mark-read, mentions inbox.
export async function getUnreads(): Promise<UnreadCount[]> {
  const res = await fetch(`/unreads`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`getUnreads ${res.status}`);
  return res.json();
}

export async function markThreadRead(threadId: string): Promise<void> {
  const res = await fetch(`/threads/${threadId}/read`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`markThreadRead ${res.status}`);
}

export async function getInbox(): Promise<InboxItem[]> {
  const res = await fetch(`/inbox`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`getInbox ${res.status}`);
  return res.json();
}

export async function memoryStats(): Promise<MemoryStats> {
  const res = await fetch(`/memory/stats`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryStats ${res.status}`);
  return res.json();
}

// #67 autonomy — Goals. NOTE: the backend exposes POST /goals + POST
// /goals/:id/decompose + POST /orgs/:orgId/tick, but there is no list-goals GET
// route, so the panel is create + decompose + run-tick (no list).
export interface Goal { id: string; orgId: string; title: string; criteria?: string | null; status?: string; threadId?: string | null; }

export async function createGoal(title: string, criteria?: string): Promise<Goal> {
  const res = await fetch(`/goals`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(criteria ? { title, criteria } : { title }),
  });
  if (!res.ok) throw new Error(`createGoal ${res.status}`);
  return res.json();
}

export async function decomposeGoal(goalId: string, threadId: string): Promise<{ taskIds: string[] }> {
  const res = await fetch(`/goals/${goalId}/decompose`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ threadId }),
  });
  if (!res.ok) throw new Error(`decomposeGoal ${res.status}`);
  return res.json();
}

// #67 self-prompt tick — bounded dispatch pass for an org. Returns the dispatched
// run ids + alert/automation counts (TickResult).
export interface TickResult { dispatched: string[]; skipped: number; reason: string; alerts: number; automations: number; }

export async function runTick(orgId: string, budgetMax?: number): Promise<TickResult> {
  const res = await fetch(`/orgs/${orgId}/tick`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(budgetMax !== undefined ? { budgetMax } : {}),
  });
  if (!res.ok) throw new Error(`runTick ${res.status}`);
  return res.json();
}

// #58/#91 agents — list + profile editing (avatar/visibility). There is no
// set-model route, so model edits aren't exposed here.
export type AgentVisibility = "public" | "private";
export interface Agent {
  id: string; orgId: string; workspaceId: string;
  handle: string; displayName: string; adapter: string;
  config: Record<string, unknown>; shared: boolean;
  avatarUrl: string | null; visibility: AgentVisibility;
}

export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`/agents`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listAgents ${res.status}`);
  return res.json();
}

export async function setAgentProfile(agentId: string, patch: { avatarUrl?: string | null; visibility?: AgentVisibility }): Promise<Agent> {
  const res = await fetch(`/agents/${agentId}/profile`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`setAgentProfile ${res.status}`);
  return res.json();
}
