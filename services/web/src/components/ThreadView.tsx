import { useEffect, useRef } from "react";
import type { Message, ChangedFile } from "../types.js";
import type { FileContent } from "../api.js";
import { MessageItem } from "./MessageItem.js";

interface ThreadViewProps {
  messages: Message[];
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
  onLoadDiff?: (runId: string) => Promise<ChangedFile[]>;
  onOpenFile?: (runId: string, path: string) => Promise<FileContent>;
  onSyncComments?: (runId: string) => void;
  onUpdatePr?: (runId: string, patch: { title?: string; body?: string; base?: string }) => void;
  onApprovePlan?: (runId: string) => void;
  onRejectPlan?: (runId: string, notes?: string) => void;
}

export function ThreadView({ messages, onApprove, onDecline, onLoadDiff, onOpenFile, onSyncComments, onUpdatePr, onApprovePlan, onRejectPlan }: ThreadViewProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  return (
    <div className="flex-1 overflow-y-auto py-3">
      {messages.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-neutral-400">No messages yet. Mention an agent to start.</p>
      )}
      {messages.map((m) => <MessageItem key={m.id} message={m} onApprove={onApprove} onDecline={onDecline} onLoadDiff={onLoadDiff} onOpenFile={onOpenFile} onSyncComments={onSyncComments} onUpdatePr={onUpdatePr} onApprovePlan={onApprovePlan} onRejectPlan={onRejectPlan} />)}
      <div ref={endRef} />
    </div>
  );
}
