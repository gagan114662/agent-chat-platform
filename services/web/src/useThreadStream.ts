import { useEffect, useRef, useState } from "react";
import type { Message } from "./types.js";
import { listMessages, postMessage } from "./api.js";
import { getToken } from "./auth.js";

function wsUrl(threadId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = getToken();
  const q = `threadId=${encodeURIComponent(threadId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  return `${proto}://${location.host}/ws?${q}`;
}

export function useThreadStream(threadId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef<Set<string>>(new Set());

  const append = (m: Message) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    seen.current = new Set();
    setMessages([]);

    listMessages(threadId).then((hist) => {
      if (cancelled) return;
      for (const m of hist) append(m);
    }).catch(() => {});

    ws = new WebSocket(wsUrl(threadId));
    ws.onmessage = (e) => {
      try { append(JSON.parse(e.data) as Message); } catch { /* ignore non-JSON */ }
    };

    return () => { cancelled = true; ws?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const send = (body: string) => postMessage(threadId, body);
  // Re-pull history (e.g. after an approve/decline action) so any message the action
  // posted shows up even if the WS push was missed. append() dedupes by id.
  const refetch = () => listMessages(threadId).then((hist) => { for (const m of hist) append(m); }).catch(() => {});
  return { messages, send, refetch };
}
