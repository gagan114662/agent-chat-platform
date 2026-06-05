import { useEffect, useState } from "react";
import { listLoginMembers, type LoginMember } from "../auth.js";

export function LoginScreen({ onLogin }: { onLogin: (memberId: string, password?: string) => void }) {
  const [members, setMembers] = useState<LoginMember[]>([]);
  const [password, setPassword] = useState("");
  useEffect(() => { listLoginMembers().then(setMembers).catch(() => {}); }, []);
  return (
    <div className="flex h-screen items-center justify-center bg-app">
      <div className="w-80 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">agent-chat</h1>
        <p className="mb-4 text-sm text-ink-2">Sign in</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (required in strict mode)"
          className="mb-3 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
        />
        <div className="space-y-2">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => onLogin(m.id, password || undefined)}
              className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-elevated"
            >
              Sign in as <span className="font-medium">{m.displayName}</span>
            </button>
          ))}
          {members.length === 0 && <p className="text-sm text-ink-3">No members to sign in as.</p>}
        </div>
      </div>
    </div>
  );
}
