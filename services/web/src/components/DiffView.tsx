import type { ChangedFile } from "../types.js";

interface DiffViewProps {
  files: ChangedFile[];
  loading?: boolean;
}

function rowClass(line: string): string {
  if (line.startsWith("@@")) return "bg-accent-soft text-accent";
  if (line.startsWith("+")) return "bg-positive/10 text-positive";
  if (line.startsWith("-")) return "bg-danger/10 text-danger";
  return "text-ink-2";
}

export function DiffView({ files, loading }: DiffViewProps) {
  if (loading) {
    return <p className="mt-3 text-xs text-ink-3">Loading diff…</p>;
  }
  if (files.length === 0) {
    return <p className="mt-3 text-xs text-ink-3">No changed files.</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      {files.map((f) => (
        <div key={f.filename} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line bg-elevated px-3 py-1.5">
            <span className="font-mono text-xs font-medium text-ink">{f.filename}</span>
            <span className="text-xs text-ink-3">
              <span className="text-positive">+{f.additions}</span>{" "}
              <span className="text-danger">−{f.deletions}</span>
            </span>
          </div>
          {f.patch ? (
            <pre className="max-h-96 overflow-auto font-mono text-xs leading-5">
              {f.patch.split("\n").map((line, i) => (
                <div key={i} className={`px-3 ${rowClass(line)}`}>{line === "" ? " " : line}</div>
              ))}
            </pre>
          ) : (
            <p className="px-3 py-2 text-xs text-ink-3">No preview available (large or binary file).</p>
          )}
        </div>
      ))}
    </div>
  );
}
