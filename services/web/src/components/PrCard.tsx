import { useState } from "react";
import type { Message, ChangedFile } from "../types.js";
import type { FileContent } from "../api.js";
import { DiffView } from "./DiffView.js";
import { FilePreview } from "./FilePreview.js";

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
  onOpenFile?: (runId: string, path: string) => Promise<FileContent>;
  onSyncComments?: (runId: string) => void;
  onUpdatePr?: (runId: string, patch: { title?: string; body?: string; base?: string }) => void;
}

export function PrCard({ message, onApprove, onDecline, onLoadDiff, onOpenFile, onSyncComments, onUpdatePr }: PrCardProps) {
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
  // A runId also lets a human edit the PR title/body/base in-thread (#56).
  const canEdit = typeof m.runId === "string";

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
      {(actionable || canDiff || canEdit) && (
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
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditOpen((o) => !o)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Edit
            </button>
          )}
        </div>
      )}
      {editOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white/70 p-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-neutral-700">
            Title
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-sm font-normal text-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-neutral-700">
            Description
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={3}
              className="rounded border border-neutral-300 px-2 py-1 text-sm font-normal text-neutral-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-neutral-700">
            Base branch
            <input
              type="text"
              value={editBase}
              onChange={(e) => setEditBase(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1 text-sm font-normal text-neutral-900"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-lg bg-[#15151f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {diffOpen && onOpenFile && (diffFiles?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white/70 p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Files</p>
          <ul className="space-y-0.5">
            {(diffFiles ?? []).map((f) => (
              <li key={f.filename}>
                <button
                  type="button"
                  onClick={() => openFile(f.filename)}
                  className={`w-full truncate rounded px-2 py-1 text-left font-mono text-xs hover:bg-neutral-100 ${openPath === f.filename ? "bg-neutral-100 font-semibold text-neutral-900" : "text-neutral-700"}`}
                >
                  {f.filename}
                </button>
              </li>
            ))}
          </ul>
          {openPath && (
            fileLoading ? (
              <p className="mt-2 px-1 text-xs text-neutral-400">Loading file…</p>
            ) : fileContent ? (
              <FilePreview filename={openPath} content={fileContent.content} encoding={fileContent.encoding} />
            ) : (
              <p className="mt-2 px-1 text-xs text-neutral-400">Could not load file.</p>
            )
          )}
        </div>
      )}
      {diffOpen && <DiffView files={diffFiles ?? []} loading={diffLoading} />}
    </div>
  );
}
