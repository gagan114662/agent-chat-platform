import { useState, type RefObject } from "react";
import type { Repo } from "../types.js";

export function NewThreadForm({ repos, onCreate, inputRef }: { repos: Repo[]; onCreate: (title: string, repoId?: string) => void; inputRef?: RefObject<HTMLInputElement> }) {
  const [title, setTitle] = useState("");
  const [repoId, setRepoId] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onCreate(t, repoId || undefined);
    setTitle("");
    setRepoId("");
  };
  return (
    <div className="border-t border-line px-3 py-3">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New thread title"
        className="mb-2 w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <select
        aria-label="repo"
        value={repoId}
        onChange={(e) => setRepoId(e.target.value)}
        className="mb-2 w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-sm text-ink"
      >
        <option value="">No repo</option>
        {repos.map((r) => <option key={r.id} value={r.id}>{r.githubOwner}/{r.githubName}</option>)}
      </select>
      <button onClick={submit} className="w-full rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
        Create thread
      </button>
    </div>
  );
}
