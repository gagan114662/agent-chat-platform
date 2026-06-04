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
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-indigo-900">
      <div className="text-xs font-semibold uppercase tracking-wide">Proposed plan</div>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-[#2b2b2b]">{message.body}</pre>
      {runId && (
        <div className="mt-3 space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional steering note for re-planning…"
            aria-label="steering note"
            className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove?.(runId)}
              className="rounded-lg bg-[#15151f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onReject?.(runId, notes.trim() === "" ? undefined : notes)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
