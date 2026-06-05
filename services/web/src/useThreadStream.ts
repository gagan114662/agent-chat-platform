import { useEffect, useRef, useState } from "react";
import type { Message } from "./types.js";
import { listMessages, postMessage, getWsTicket } from "./api.js";

export function useThreadStream(threadId: string, onLiveMessage?: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const onLive = useRef(onLiveMessage);
  onLive.current = onLiveMessage;

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

    const proto = location.protocol === "https:" ? "wss" : "ws";
    // Fetch a short-lived single-use ticket first, then open the socket — the token
    // never rides in the WS URL (proxy-loggable). Falls back to no ticket if none.
    getWsTicket().then((ticket) => {
      if (cancelled) return;
      const q = `threadId=${encodeURIComponent(threadId)}${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ""}`;
      ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
      ws.onmessage = (e) => {
        try { append(JSON.parse(e.data) as Message); onLive.current?.(); } catch { /* ignore non-JSON */ }
      };
    }).catch(() => {});

    return () => { cancelled = true; ws?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Post then refetch so the message (and any system/pr_card it spawned) shows up
  // even if the WS push is missed (#123). Rejects on a non-2xx so the composer can
  // surface the error instead of silently clearing.
  // Re-pull history (e.g. after an approve/decline action) so any message the action
  // posted shows up even if the WS push was missed. append() dedupes by id.
  const refetch = () => listMessages(threadId).then((hist) => { for (const m of hist) append(m); }).catch(() => {});
  const send = async (body: string) => {
    const r = await postMessage(threadId, body);
    refetch();
    return r;
  };
  return { messages, send, refetch };
}
