import { useState } from "react";
import type { Message, ChangedFile, Checkpoint } from "../types.js";
import type { FileContent } from "../api.js";
import { DiffView } from "./DiffView.js";
import { FilePreview } from "./FilePreview.js";

const OUTCOME_STYLES: Record<string, string> = {
  merged: "bg-positive/10 text-positive border-positive/30",
  checks_failed: "bg-danger/10 text-danger border-danger/30",
  timeout: "bg-warn/10 text-warn border-warn/30",
  error: "bg-danger/10 text-danger border-danger/30",
  held_for_human: "bg-warn/10 text-warn border-warn/30",
};

interface PrCardProps {
  message: Message;
  onApprove?: (runId: string) => void;
  onDecline?: (runId: string) => void;
  onLoadDiff?: (runId: string) => Promise<ChangedFile[]>;
  onOpenFile?: (runId: string, path: string) => Promise<FileContent>;
  onSyncComments?: (runId: string) => void;
  onUpdatePr?: (runId: string, patch: { title?: string; body?: string; base?: string }) => void;
  onLoadCheckpoints?: (runId: string) => Promise<Checkpoint[]>;
  onRestoreCheckpoint?: (runId: string, cpId: string) => void;
  // #64 concurrent runs: pick this run as the winner among its task's siblings.
  onSelectRun?: (runId: string) => void;
}

export function PrCard({ message, onApprove, onDecline, onLoadDiff, onOpenFile, onSyncComments, onUpdatePr, onLoadCheckpoints, onRestoreCheckpoint, onSelectRun }: PrCardProps) {
  const m = message.metadata as { outcome?: string; prNumber?: number; prUrl?: string; runId?: string; parentRunId?: string; selected?: boolean };
  const outcome = m.outcome ?? "merged";
  // #53 stacked PRs: when this run is a child of another, surface a small badge.
  const parentRunId = typeof m.parentRunId === "string" ? m.parentRunId : undefined;
  // Only treat https:// URLs as links — never render javascript:/data:/etc. as an href.
  const safePrUrl = m.prUrl && m.prUrl.startsWith("https://") ? m.prUrl : undefined;
  // A held_for_human card with a runId is human-actionable: offer Approve / Decline.
  const actionable = outcome === "held_for_human" && typeof m.runId === "string";
  // Any card carrying a runId can show its PR diff (lazy-loaded).
  const canDiff = typeof m.runId === "string";
  // A runId also lets a human edit the PR title/body/base in-thread (#56).
  const canEdit = typeof m.runId === "string";
  // #62: a runId lets a human list + restore the run's checkpoints (commit snapshots).
  const canCheckpoint = typeof m.runId === "string";
  // #64 concurrent runs: a runId + an onSelectRun handler lets a human pick this run
  // as the winner among its task's siblings. `selected` (if the sink carries it)
  // surfaces a winner badge.
  const canSelect = typeof m.runId === "string" && !!onSelectRun;
  const isSelected = m.selected === true;

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffFiles, setDiffFiles] = useState<ChangedFile[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // File explorer / preview (#59): reuses the changed-file list fetched for the diff.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const openFile = (path: string) => {
    if (!onOpenFile || !m.runId) return;
    setOpenPath(path);
    setFileContent(null);
    setFileLoading(true);
    onOpenFile(m.runId, path)
      .then((f) => setFileContent(f))
      .catch(() => setFileContent(null))
      .finally(() => setFileLoading(false));
  };

  // #62 checkpoints: lazy-loaded list of the run's commit snapshots.
  const [cpOpen, setCpOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [cpLoading, setCpLoading] = useState(false);

  const toggleCheckpoints = () => {
    if (cpOpen) { setCpOpen(false); return; }
    setCpOpen(true);
    if (checkpoints === null && onLoadCheckpoints && m.runId) {
      setCpLoading(true);
      onLoadCheckpoints(m.runId)
        .then((cps) => setCheckpoints(cps))
        .catch(() => setCheckpoints([]))
        .finally(() => setCpLoading(false));
    }
  };

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBase, setEditBase] = useState("");

  const saveEdit = () => {
    if (!onUpdatePr || !m.runId) return;
    // Only send fields the human actually filled in — blanks are left untouched.
    const patch: { title?: string; body?: string; base?: string } = {};
    if (editTitle.trim() !== "") patch.title = editTitle;
    if (editBody.trim() !== "") patch.body = editBody;
    if (editBase.trim() !== "") patch.base = editBase;
    onUpdatePr(m.runId, patch);
    setEditOpen(false);
  };

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
            <a href={safePrUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink underline underline-offset-2">
              PR #{m.prNumber}
            </a>
          ) : (
            <span className="text-sm font-medium text-ink">PR #{m.prNumber}</span>
          )
        )}
        {parentRunId && (
          <span className="rounded-full border border-line bg-app/40 px-2 py-0.5 text-[11px] font-medium text-ink-2">
            ⬑ stacked on {parentRunId}
          </span>
        )}
        {isSelected && (
          <span className="rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">
            ✓ selected
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-ink">{message.body}</p>
      {(actionable || canDiff || canEdit || canCheckpoint || canSelect) && (
        <div className="mt-3 flex gap-2">
          {actionable && (
            <button
              type="button"
              onClick={() => onApprove?.(m.runId!)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              Approve
            </button>
          )}
          {actionable && (
            <button
              type="button"
              onClick={() => onDecline?.(m.runId!)}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              Decline
            </button>
          )}
          {canDiff && (
            <button
              type="button"
              onClick={toggleDiff}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              {diffOpen ? "Hide diff" : "View diff"}
            </button>
          )}
          {canDiff && (
            <button
              type="button"
              onClick={() => onSyncComments?.(m.runId!)}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              ↻ Sync comments
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditOpen((o) => !o)}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              Edit
            </button>
          )}
          {canCheckpoint && (
            <button
              type="button"
              onClick={toggleCheckpoints}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              {cpOpen ? "Hide checkpoints" : "Checkpoints"}
            </button>
          )}
          {canSelect && (
            <button
              type="button"
              onClick={() => onSelectRun?.(m.runId!)}
              className="rounded-lg border border-positive/40 bg-elevated px-3 py-1.5 text-xs font-semibold text-positive hover:bg-positive/20"
            >
              Select
            </button>
          )}
        </div>
      )}
      {cpOpen && (
        <div className="mt-3 rounded-lg border border-line bg-app/40 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Checkpoints</p>
          {cpLoading ? (
            <p className="px-1 text-xs text-ink-3">Loading checkpoints…</p>
          ) : (checkpoints?.length ?? 0) === 0 ? (
            <p className="px-1 text-xs text-ink-3">No checkpoints yet.</p>
          ) : (
            <ul className="space-y-1">
              {(checkpoints ?? []).map((cp) => (
                <li key={cp.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-ink-2">
                    <span className="font-medium">{cp.label}</span>{" "}
                    <span className="font-mono text-ink-3">{cp.branch} · {cp.commitSha.slice(0, 7)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => m.runId && onRestoreCheckpoint?.(m.runId, cp.id)}
                    className="shrink-0 rounded-lg border border-line bg-elevated px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
                  >
                    ↩ Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-app/40 p-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Title
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="rounded border border-line px-2 py-1 text-sm font-normal text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Description
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              className="rounded border border-line px-2 py-1 text-sm font-normal text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Base branch
            <input
              type="text"
              value={editBase}
              onChange={(e) => setEditBase(e.target.value)}
              className="rounded border border-line px-2 py-1 text-sm font-normal text-ink"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-elevated-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {diffOpen && onOpenFile && (diffFiles?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-app/40 p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Files</p>
          <ul className="space-y-0.5">
            {(diffFiles ?? []).map((f) => (
              <li key={f.filename}>
                <button
                  type="button"
                  onClick={() => openFile(f.filename)}
                  className={`w-full truncate rounded px-2 py-1 text-left font-mono text-xs hover:bg-elevated ${openPath === f.filename ? "bg-elevated-2 font-semibold text-ink" : "text-ink-2"}`}
                >
                  {f.filename}
                </button>
              </li>
            ))}
          </ul>
          {openPath && (
            fileLoading ? (
              <p className="mt-2 px-1 text-xs text-ink-3">Loading file…</p>
            ) : fileContent ? (
              <FilePreview filename={openPath} content={fileContent.content} encoding={fileContent.encoding} />
            ) : (
              <p className="mt-2 px-1 text-xs text-ink-3">Could not load file.</p>
            )
          )}
        </div>
      )}
      {diffOpen && <DiffView files={diffFiles ?? []} loading={diffLoading} />}
    </div>
  );
}
