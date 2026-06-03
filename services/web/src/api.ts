import type { Message } from "./types.js";
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
