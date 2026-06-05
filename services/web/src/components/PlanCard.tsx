import { useState } from "react";
import type { Message } from "../types.js";

interface PlanCardProps {
  message: Message;
  onApprove?: (runId: string) => void;
  onReject?: (runId: string, notes?: string) => void;
}

// Renders a proposed plan (plan_card) with Approve / Reject buttons and an optional
// steering note. Approve executes the run; Reject declines (and, with a note, re-plans).
export function PlanCard({ message, onApprove, onReject }: PlanCardProps) {
  const m = message.metadata as { runId?: string };
  const runId = typeof m.runId === "string" ? m.runId : undefined;
  const [notes, setNotes] = useState("");

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-ink">
      <div className="text-xs font-semibold uppercase tracking-wide text-accent">Proposed plan</div>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-ink-2">{message.body}</pre>
      {runId && (
        <div className="mt-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional steering note for re-planning…"
            aria-label="steering note"
            className="w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-ink placeholder:text-ink-3"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove?.(runId)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject?.(runId, notes.trim() === "" ? undefined : notes)}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2 hover:text-ink"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
