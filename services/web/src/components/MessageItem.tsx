import type { Message, ChangedFile } from "../types.js";
import { PrCard } from "./PrCard.js";

interface MessageItemProps {
  message: Message;
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
  onLoadDiff?: (runId: string) => Promise<ChangedFile[]>;
  onSyncComments?: (runId: string) => void;
}

export function MessageItem({ message, onApprove, onDecline, onLoadDiff, onSyncComments }: MessageItemProps) {
  if (message.kind === "pr_card") {
    return <div className="px-4 py-1.5"><PrCard message={message} onApprove={onApprove} onDecline={onDecline} onLoadDiff={onLoadDiff} onSyncComments={onSyncComments} /></div>;
  }
  if (message.kind === "system") {
    return (
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-neutral-400">{message.body}</span>
      </div>
    );
  }
  // chat
  const isAgent = message.authorKind === "agent";
  return (
    <div className="flex gap-3 px-4 py-2">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${isAgent ? "bg-[#15151f]" : "bg-neutral-400"}`}>
        {isAgent ? "🤖" : message.authorId.slice(0, 2).toUpperCase()}
      </div>
      <div>
        <div className="text-xs font-medium text-neutral-500">{isAgent ? "agent" : message.authorId}</div>
        <div className="text-sm whitespace-pre-wrap text-[#2b2b2b]">{message.body}</div>
      </div>
    </div>
  );
}
