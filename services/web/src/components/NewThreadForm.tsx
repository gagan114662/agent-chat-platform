import { useState } from "react";
import type { Repo } from "../types.js";

export function NewThreadForm({ repos, onCreate }: { repos: Repo[]; onCreate: (title: string, repoId?: string) => void }) {
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
    <div className="border-t border-[#e7e7f0] px-3 py-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New thread title"
        className="mb-2 w-full rounded-lg border border-[#e7e7f0] px-2 py-1.5 text-sm focus:border-neutral-800 focus:outline-none"
      />
      <select
        aria-label="repo"
        value={repoId}
        onChange={(e) => setRepoId(e.target.value)}
        className="mb-2 w-full rounded-lg border border-[#e7e7f0] px-2 py-1.5 text-sm"
      >
        <option value="">No repo</option>
        {repos.map((r) => <option key={r.id} value={r.id}>{r.githubOwner}/{r.githubName}</option>)}
      </select>
      <button onClick={submit} className="w-full rounded-lg bg-[#15151f] px-2 py-1.5 text-sm font-medium text-white hover:bg-black">
        Create thread
      </button>
    </div>
  );
}
