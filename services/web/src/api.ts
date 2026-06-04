import type { Message, Channel, Thread, Repo, SearchResult, Principal, MemoryGraph, MemoryStats, MemoryKind, MemoryScope, ChangedFile } from "./types.js";
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

export async function runDiff(runId: string): Promise<ChangedFile[]> {
  const res = await fetch(`/runs/${runId}/diff`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`runDiff ${res.status}`);
  return res.json();
}

export async function syncPrComments(runId: string): Promise<{ synced: number }> {
  const res = await fetch(`/runs/${runId}/sync-comments`, { method: "POST", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`syncPrComments ${res.status}`);
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

export async function memoryStats(): Promise<MemoryStats> {
  const res = await fetch(`/memory/stats`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`memoryStats ${res.status}`);
  return res.json();
}
