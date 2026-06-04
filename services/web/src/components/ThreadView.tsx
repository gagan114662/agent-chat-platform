import { useEffect, useRef } from "react";
import type { Message } from "../types.js";
import { MessageItem } from "./MessageItem.js";

interface ThreadViewProps {
  messages: Message[];
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
}

export function ThreadView({ messages, onApprove, onDecline }: ThreadViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  return (
    <div className="flex-1 overflow-y-auto py-3">
      {messages.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-neutral-400">No messages yet. Mention an agent to start.</p>
      )}
      {messages.map((m) => <MessageItem key={m.id} message={m} onApprove={onApprove} onDecline={onDecline} />)}
      <div ref={endRef} />
    </div>
  );
}
