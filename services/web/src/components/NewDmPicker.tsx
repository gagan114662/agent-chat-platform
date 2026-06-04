import type { Principal } from "../types.js";

export function NewDmPicker({ principals, onStartDm }: {
  principals: Principal[];
  onStartDm: (peerKind: "human" | "agent", peerId: string) => void;
}) {
  return (
    <select
      aria-label="start dm"
      value=""
      onChange={(e) => {
        const p = principals.find((x) => x.id === e.target.value);
        if (p) onStartDm(p.kind, p.id);
      }}
      className="mx-3 mb-2 rounded-lg border border-[#e7e7f0] px-2 py-1 text-xs text-neutral-600 focus:border-neutral-800 focus:outline-none"
    >
      <option value="">+ New DM…</option>
      {principals.map((p) => <option key={p.id} value={p.id}>{p.kind === "agent" ? "🤖 " : ""}{p.name}</option>)}
    </select>
  );
}
