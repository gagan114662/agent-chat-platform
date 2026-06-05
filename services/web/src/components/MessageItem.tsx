import type { Message, ChangedFile, Checkpoint } from "../types.js";
import type { FileContent } from "../api.js";
import { PrCard } from "./PrCard.js";
import { PlanCard } from "./PlanCard.js";
import { Icon } from "./Icon.js";

interface MessageItemProps {
  message: Message;
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
  onLoadDiff?: (runId: string) => Promise<ChangedFile[]>;
  onOpenFile?: (runId: string, path: string) => Promise<FileContent>;
  onSyncComments?: (runId: string) => void;
  onUpdatePr?: (runId: string, patch: { title?: string; body?: string; base?: string }) => void;
  onLoadCheckpoints?: (runId: string) => Promise<Checkpoint[]>;
  onRestoreCheckpoint?: (runId: string, cpId: string) => void;
  onApprovePlan?: (runId: string) => void;
  onRejectPlan?: (runId: string, notes?: string) => void;
}

// Short clock label (e.g. "9:02 AM") from an ISO timestamp; empty if unparseable.
function clock(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageItem({ message, onApprove, onDecline, onLoadDiff, onOpenFile, onSyncComments, onUpdatePr, onLoadCheckpoints, onRestoreCheckpoint, onApprovePlan, onRejectPlan }: MessageItemProps) {
  if (message.kind === "pr_card") {
    return <div className="px-4 py-1.5"><PrCard message={message} onApprove={onApprove} onDecline={onDecline} onLoadDiff={onLoadDiff} onOpenFile={onOpenFile} onSyncComments={onSyncComments} onUpdatePr={onUpdatePr} onLoadCheckpoints={onLoadCheckpoints} onRestoreCheckpoint={onRestoreCheckpoint} /></div>;
  }
  if (message.kind === "plan_card") {
    return <div className="px-4 py-1.5"><PlanCard message={message} onApprove={onApprovePlan} onReject={onRejectPlan} /></div>;
  }
  if (message.kind === "system") {
    // Quiet activity row: a tiny rail dot + muted text, aligned under messages.
    return (
      <div className="flex items-center gap-2.5 py-0.5 pl-[34px] pr-4">
        <span className="h-1 w-1 shrink-0 rounded-full bg-ink-3/60" />
        <span className="text-[12px] leading-5 text-ink-3">{message.body}</span>
      </div>
    );
  }
  // chat
  const isAgent = message.authorKind === "agent";
  const ts = clock(message.createdAt);
  return (
    <div className="group flex gap-3 px-4 py-1.5 transition-colors hover:bg-surface-2">
      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white ${isAgent ? "bg-gradient-to-br from-accent to-[#5b48e0]" : "bg-elevated-2 text-ink-2"}`}>
        {isAgent ? <Icon name="agents" size={16} className="text-white" /> : message.authorId.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{message.authorId}</span>
          {isAgent && <span className="text-[12px] text-ink-3">@{message.authorId}</span>}
          {isAgent && (
            <span className="rounded border border-warn/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-warn">agent</span>
          )}
          {ts && <span className="ml-auto text-[11px] text-ink-3">{ts}</span>}
        </div>
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink/90">{message.body}</div>
      </div>
    </div>
  );
}
