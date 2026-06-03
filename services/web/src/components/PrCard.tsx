import type { Message } from "../types.js";

const OUTCOME_STYLES: Record<string, string> = {
  merged: "bg-emerald-50 text-emerald-700 border-emerald-200",
  checks_failed: "bg-rose-50 text-rose-700 border-rose-200",
  timeout: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
};

export function PrCard({ message }: { message: Message }) {
  const m = message.metadata as { outcome?: string; prNumber?: number; prUrl?: string };
  const outcome = m.outcome ?? "merged";
  return (
    <div className={`rounded-lg border px-4 py-3 ${OUTCOME_STYLES[outcome] ?? OUTCOME_STYLES.merged}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">{outcome.replace("_", " ")}</span>
        {m.prNumber != null && (
          <a href={m.prUrl} target="_blank" rel="noreferrer" className="text-sm font-medium underline underline-offset-2">
            PR #{m.prNumber}
          </a>
        )}
      </div>
      <p className="mt-1 text-sm">{message.body}</p>
    </div>
  );
}
