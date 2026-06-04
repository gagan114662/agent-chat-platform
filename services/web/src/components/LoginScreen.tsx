import { useEffect, useState } from "react";
import { listLoginMembers, type LoginMember } from "../auth.js";

export function LoginScreen({ onLogin }: { onLogin: (memberId: string, password?: string) => void }) {
  const [members, setMembers] = useState<LoginMember[]>([]);
  const [password, setPassword] = useState("");
  useEffect(() => { listLoginMembers().then(setMembers).catch(() => {}); }, []);
  return (
    <div className="flex h-screen items-center justify-center bg-[#f0f0f7]">
      <div className="w-80 rounded-xl border border-[#e7e7f0] bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-neutral-800">agent-chat</h1>
        <p className="mb-4 text-sm text-neutral-500">Sign in</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (required in strict mode)"
          className="mb-3 w-full rounded-lg border border-[#e7e7f0] px-3 py-2 text-sm focus:border-neutral-800 focus:outline-none"
        />
        <div className="space-y-2">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => onLogin(m.id, password || undefined)}
              className="block w-full rounded-lg border border-[#e7e7f0] px-3 py-2 text-left text-sm hover:bg-neutral-50"
            >
              Sign in as <span className="font-medium">{m.displayName}</span>
            </button>
          ))}
          {members.length === 0 && <p className="text-sm text-neutral-400">No members to sign in as.</p>}
        </div>
      </div>
    </div>
  );
}
