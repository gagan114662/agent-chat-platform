import type { Message, Channel, Thread, Repo, SearchResult, Principal } from "./types.js";
import { DEV_HEADERS } from "./types.js";

export async function listMessages(threadId: string): Promise<Message[]> {
  const res = await fetch(`/threads/${threadId}/messages`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listMessages ${res.status}`);
  return res.json();
}

export async function postMessage(threadId: string, body: string): Promise<{ message: Message; startedRuns: string[] }> {
  const res = await fetch(`/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV_HEADERS },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`postMessage ${res.status}`);
  return res.json();
}

export async function listChannels(): Promise<Channel[]> {
  const res = await fetch(`/channels`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listChannels ${res.status}`);
  return res.json();
}

export async function listThreads(channelId: string): Promise<Thread[]> {
  const res = await fetch(`/channels/${channelId}/threads`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listThreads ${res.status}`);
  return res.json();
}

export async function createThread(channelId: string, input: { title: string; repoId?: string }): Promise<Thread> {
  const res = await fetch(`/channels/${channelId}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV_HEADERS },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createThread ${res.status}`);
  return res.json();
}

export async function listRepos(): Promise<Repo[]> {
  const res = await fetch(`/repos`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listRepos ${res.status}`);
  return res.json();
}

export async function createChannel(name: string): Promise<Channel> {
  const res = await fetch(`/channels`, {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV_HEADERS },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createChannel ${res.status}`);
  return res.json();
}

export async function searchMessages(q: string): Promise<SearchResult[]> {
  const res = await fetch(`/search?q=${encodeURIComponent(q)}`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`searchMessages ${res.status}`);
  return res.json();
}

export async function listPrincipals(): Promise<Principal[]> {
  const res = await fetch(`/principals`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listPrincipals ${res.status}`);
  return res.json();
}

export async function listDms(): Promise<Thread[]> {
  const res = await fetch(`/dms`, { headers: { ...DEV_HEADERS } });
  if (!res.ok) throw new Error(`listDms ${res.status}`);
  return res.json();
}

export async function startDm(peerKind: "human" | "agent", peerId: string): Promise<Thread> {
  const res = await fetch(`/dms`, {
    method: "POST",
    headers: { "content-type": "application/json", ...DEV_HEADERS },
    body: JSON.stringify({ peerKind, peerId }),
  });
  if (!res.ok) throw new Error(`startDm ${res.status}`);
  return res.json();
}
