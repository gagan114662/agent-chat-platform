import type { ChangedFile } from "../types.js";

interface DiffViewProps {
  files: ChangedFile[];
  loading?: boolean;
}

function rowClass(line: string): string {
  if (line.startsWith("@@")) return "bg-indigo-50 text-indigo-700";
  if (line.startsWith("+")) return "bg-emerald-50 text-emerald-800";
  if (line.startsWith("-")) return "bg-rose-50 text-rose-800";
  return "text-neutral-600";
}

export function DiffView({ files, loading }: DiffViewProps) {
  if (loading) {
    return <p className="mt-3 text-xs text-neutral-400">Loading diff…</p>;
  }
  if (files.length === 0) {
    return <p className="mt-3 text-xs text-neutral-400">No changed files.</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      {files.map((f) => (
        <div key={f.filename} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-1.5">
            <span className="font-mono text-xs font-medium text-neutral-800">{f.filename}</span>
            <span className="text-xs text-neutral-500">
              <span className="text-emerald-700">+{f.additions}</span>{" "}
              <span className="text-rose-700">−{f.deletions}</span>
            </span>
          </div>
          {f.patch ? (
            <pre className="max-h-96 overflow-auto font-mono text-xs leading-5">
              {f.patch.split("\n").map((line, i) => (
                <div key={i} className={`px-3 ${rowClass(line)}`}>{line === "" ? " " : line}</div>
              ))}
            </pre>
          ) : (
            <p className="px-3 py-2 text-xs text-neutral-400">No preview available (large or binary file).</p>
          )}
        </div>
      ))}
    </div>
  );
}
