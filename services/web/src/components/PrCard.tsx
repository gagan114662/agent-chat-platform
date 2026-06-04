import { useState } from "react";
import type { Message, ChangedFile } from "../types.js";
import { DiffView } from "./DiffView.js";

const OUTCOME_STYLES: Record<string, string> = {
  merged: "bg-emerald-50 text-emerald-700 border-emerald-200",
  checks_failed: "bg-rose-50 text-rose-700 border-rose-200",
  timeout: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  held_for_human: "bg-amber-50 text-amber-800 border-amber-200",
};

interface PrCardProps {
  message: Message;
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
  onLoadDiff?: (runId: string) => Promise<ChangedFile[]>;
  onSyncComments?: (runId: string) => void;
}

export function PrCard({ message, onApprove, onDecline, onLoadDiff, onSyncComments }: PrCardProps) {
  const m = message.metadata as { outcome?: string; prNumber?: number; prUrl?: string; runId?: string; parentRunId?: string };
  const outcome = m.outcome ?? "merged";
  // #53 stacked PRs: when this run is a child of another, surface a small badge.
  const parentRunId = typeof m.parentRunId === "string" ? m.parentRunId : undefined;
  // Only treat https:// URLs as links — never render javascript:/data:/etc. as an href.
  const safePrUrl = m.prUrl && m.prUrl.startsWith("https://") ? m.prUrl : undefined;
  // A held_for_human card with a runId is human-actionable: offer Approve / Decline.
  const actionable = outcome === "held_for_human" && typeof m.runId === "string";
  // Any card carrying a runId can show its PR diff (lazy-loaded).
  const canDiff = typeof m.runId === "string";

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffFiles, setDiffFiles] = useState<ChangedFile[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const toggleDiff = () => {
    if (diffOpen) { setDiffOpen(false); return; }
    setDiffOpen(true);
    if (diffFiles === null && onLoadDiff && m.runId) {
      setDiffLoading(true);
      onLoadDiff(m.runId)
        .then((files) => setDiffFiles(files))
        .catch(() => setDiffFiles([]))
        .finally(() => setDiffLoading(false));
    }
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES.merged}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">{outcome.replace("_", " ")}</span>
        {m.prNumber != null && (
          safePrUrl ? (
            <a href={safePrUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-neutral-800 underline underline-offset-2">
              PR #{m.prNumber}
            </a>
          ) : (
            <span className="text-sm font-medium text-neutral-800">PR #{m.prNumber}</span>
          )
        )}
        {parentRunId && (
          <span className="rounded-full border border-neutral-300 bg-white/60 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
            ⬑ stacked on {parentRunId}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm">{message.body}</p>
      {(actionable || canDiff) && (
        <div className="mt-3 flex gap-2">
          {actionable && (
            <button
              type="button"
              onClick={() => onApprove?.(m.runId!)}
              className="rounded-lg bg-[#15151f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
            >
              Approve
            </button>
          )}
          {actionable && (
            <button
              type="button"
              onClick={() => onDecline?.(m.runId!)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Decline
            </button>
          )}
          {canDiff && (
            <button
              type="button"
              onClick={toggleDiff}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              {diffOpen ? "Hide diff" : "View diff"}
            </button>
          )}
          {canDiff && (
            <button
              type="button"
              onClick={() => onSyncComments?.(m.runId!)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              ↻ Sync comments
            </button>
          )}
        </div>
      )}
      {diffOpen && <DiffView files={diffFiles ?? []} loading={diffLoading} />}
    </div>
  );
}
