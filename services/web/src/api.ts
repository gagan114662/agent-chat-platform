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
export interface Goal { id: string; orgId: string; title: string; criteria?: string | null; status?: string; state?: string; threadId?: string | null; }

export async function listGoals(): Promise<Goal[]> {
  const res = await fetch(`/goals`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listGoals ${res.status}`);
  const { goals } = (await res.json()) as { goals: Goal[] };
  return goals;
}

export async function createGoal(title: string, criteria?: string): Promise<Goal> {
  const res = await fetch(`/goals`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(criteria ? { title, criteria } : { title }),
  });
  if (!res.ok) throw new Error(`createGoal ${res.status}`);
  return res.json();
}

export async function decomposeGoal(goalId: string, threadId: string, assigneeId?: string): Promise<{ taskIds: string[] }> {
  const res = await fetch(`/goals/${goalId}/decompose`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(assigneeId ? { threadId, assigneeId } : { threadId }),
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
  // #128 live reputation from verified run outcomes.
  reputation?: { scorePct: number; runs: number };
}

export async function listActiveAgents(): Promise<string[]> {
  const res = await fetch(`/agents/active`, { headers: { ...authHeaders() } });
  if (!res.ok) return [];
  const { active } = (await res.json()) as { active: string[] };
  return active;
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

// #108 create a new agent (handle + display name + adapter). 402 when the plan's
// agent quota is exhausted; 403 for non-admins.
export async function createAgent(input: { handle: string; displayName: string; adapter?: string }): Promise<Agent> {
  const res = await fetch(`/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = res.status === 402 ? "agent limit reached — upgrade your plan" : res.status === 403 ? "only admins can add agents" : `createAgent ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

// #81 richer tasks — the valid priority/state values mirrored from the backend
// (services/app/src/tasks/tasks.ts) for the inline-edit dropdowns.
export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_STATES = ["open", "backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface Task {
  id: string; orgId: string; threadId: string; title: string;
  state: TaskState; priority: TaskPriority;
  assigneeKind?: string | null; assigneeId?: string | null;
  dueDate?: string | null;
  createdByKind: string; createdById: string;
}
export interface TaskComment { id: string; orgId: string; taskId: string; authorKind: string; authorId: string; body: string; createdAt: string; }
export interface TaskRelation { id: string; orgId: string; fromTaskId: string; toTaskId: string; relation: "blocks" | "related" | "duplicate"; createdAt: string; }
export interface TaskDetail { task: Task; comments: TaskComment[]; relations: TaskRelation[]; }

export async function listTasks(): Promise<Task[]> {
  const res = await fetch(`/tasks`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listTasks ${res.status}`);
  const { tasks } = (await res.json()) as { tasks: Task[] };
  return tasks;
}

export async function getTask(id: string): Promise<TaskDetail> {
  const res = await fetch(`/tasks/${id}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`getTask ${res.status}`);
  return res.json();
}

export async function updateTask(id: string, patch: { priority?: TaskPriority; dueDate?: string | null; state?: TaskState }): Promise<Task> {
  const res = await fetch(`/tasks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateTask ${res.status}`);
  const { task } = (await res.json()) as { task: Task };
  return task;
}

export async function addTaskComment(id: string, body: string): Promise<TaskComment> {
  const res = await fetch(`/tasks/${id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`addTaskComment ${res.status}`);
  const { comment } = (await res.json()) as { comment: TaskComment };
  return comment;
}

export interface BulkTaskItem { title: string; priority?: TaskPriority; state?: TaskState; }
export async function bulkCreateTasks(threadId: string, items: BulkTaskItem[]): Promise<{ ids: string[] }> {
  const res = await fetch(`/tasks/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ threadId, items }),
  });
  if (!res.ok) throw new Error(`bulkCreateTasks ${res.status}`);
  return res.json();
}

// #99 persistent internal tools: a registry of agent/admin-built HTML
// tools/dashboards. Content is rendered ONLY in a `sandbox=""` iframe (ToolView).
export interface Tool {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  kind: "dashboard" | "form" | "page";
  content: string;
  published: boolean;
  createdByKind: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export async function listTools(
  workspaceId: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<Tool[]> {
  const qs = new URLSearchParams({ workspaceId });
  if (opts.publishedOnly) qs.set("publishedOnly", "1");
  const res = await fetch(`/tools?${qs.toString()}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listTools ${res.status}`);
  return res.json();
}

export async function getTool(id: string): Promise<Tool> {
  const res = await fetch(`/tools/${id}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`getTool ${res.status}`);
  return res.json();
}

// #85 billing — the org's plan + usage + per-resource quotas, the pricing tiers,
// and a Stripe Checkout (upgrade). Shapes mirror services/app/src/billing/plans.ts.
// A quota `limit` of -1 means unlimited.
export type QuotaKind = "seats" | "agents" | "messages" | "tasks";
export interface Plan {
  id: string; name: string;
  seatLimit: number; agentLimit: number; messageQuota: number; taskQuota: number;
  stripePriceId: string | null;
}
export interface Usage { seats: number; agents: number; messages: number; tasks: number; }
export interface Quota { used: number; limit: number; ok: boolean; }
export interface Billing { plan: Plan; usage: Usage; quotas: Record<QuotaKind, Quota>; }

export async function getBilling(): Promise<Billing> {
  const res = await fetch(`/billing`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`getBilling ${res.status}`);
  return res.json();
}

export async function listPlans(): Promise<Plan[]> {
  const res = await fetch(`/billing/plans`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listPlans ${res.status}`);
  return res.json();
}

// Builds a Stripe Checkout Session for the chosen plan and returns its URL. The
// caller redirects to it. Admin-only on the backend (403 for members); 400 when
// the plan has no Stripe price or Stripe isn't configured.
export async function billingCheckout(planId: string): Promise<{ url: string }> {
  const res = await fetch(`/billing/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ planId }),
  });
  if (!res.ok) throw new Error(`billingCheckout ${res.status}`);
  return res.json();
}

// #98 automations — schedule/event trigger → message/run/slack action. Shapes
// mirror services/app/src/autonomy/automations.ts. Mutations are admin-only.
export type AutomationTrigger =
  | { type: "schedule"; everyMinutes: number }
  | { type: "event"; event: string };
export type AutomationAction =
  | { type: "message"; threadId: string; body: string }
  | { type: "run"; threadId: string; agentId: string; intent: string }
  | { type: "slack"; channel: string; text: string };
export interface Automation {
  id: string; orgId: string; name: string;
  trigger: AutomationTrigger; action: AutomationAction;
  enabled: boolean; lastFiredAt: string | null;
  createdById: string; createdAt: string;
}

export async function listAutomations(): Promise<Automation[]> {
  const res = await fetch(`/automations`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listAutomations ${res.status}`);
  return res.json();
}

export async function createAutomation(name: string, trigger: AutomationTrigger, action: AutomationAction): Promise<Automation> {
  const res = await fetch(`/automations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, trigger, action }),
  });
  if (!res.ok) throw new Error(`createAutomation ${res.status}`);
  return res.json();
}

export async function setAutomationEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await fetch(`/automations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`setAutomationEnabled ${res.status}`);
}

export async function deleteAutomation(id: string): Promise<void> {
  const res = await fetch(`/automations/${id}`, { method: "DELETE", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`deleteAutomation ${res.status}`);
}

// #26/#40/#82 memory — recall search (intent → ranked nodes), consolidate
// ("dream": cluster recent nodes into summaries), and a node list. Shapes mirror
// services/app/src/memory/memory.ts (memoryNodes rows).
export type MemoryNodeKind = "decision" | "fact" | "preference" | "identity" | "artifact";
export interface MemoryNode {
  id: string; orgId: string; kind: MemoryNodeKind; scope: string;
  label: string; body: string;
  metadata: Record<string, unknown>; version: number; status: string;
  createdAt: string;
}

export async function memoryRecall(q: string, limit?: number): Promise<MemoryNode[]> {
  const qs = new URLSearchParams({ q });
  if (limit !== undefined) qs.set("limit", String(limit));
  const res = await fetch(`/memory/recall?${qs.toString()}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryRecall ${res.status}`);
  return res.json();
}

export async function memoryConsolidate(): Promise<{ created: number; clusters: number }> {
  const res = await fetch(`/memory/consolidate`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryConsolidate ${res.status}`);
  return res.json();
}

// GET /memory lists the org's nodes (active by default). An optional `q` runs a
// label/body search instead (searchNodes).
export async function listMemoryNodes(q?: string): Promise<MemoryNode[]> {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  const res = await fetch(`/memory${qs.toString() ? `?${qs}` : ""}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listMemoryNodes ${res.status}`);
  return res.json();
}
