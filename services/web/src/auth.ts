import { DEV_HEADERS } from "./types.js";

const TOKEN_KEY = "acp_token";

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

// Bearer token when logged in; dev-header stub otherwise (incremental migration).
export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : { ...DEV_HEADERS };
}

export interface Principal { orgId: string; userId: string; role?: "admin" | "member"; }
export interface LoginMember { id: string; displayName: string; orgId: string; }

export async function listLoginMembers(): Promise<LoginMember[]> {
  const res = await fetch(`/auth/members`);
  if (!res.ok) throw new Error(`listLoginMembers ${res.status}`);
  return res.json();
}

export async function login(memberId: string): Promise<Principal> {
  const res = await fetch(`/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  const { token, member } = await res.json() as { token: string; member: { orgId: string } };
  setToken(token);
  return { orgId: member.orgId, userId: memberId };
}

export async function me(): Promise<Principal | null> {
  const res = await fetch(`/auth/me`, { headers: { ...authHeaders() } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me ${res.status}`);
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`/auth/logout`, { method: "POST", headers: { ...authHeaders() } });
  clearToken();
}
