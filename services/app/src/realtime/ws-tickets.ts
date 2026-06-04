import { randomBytes } from "node:crypto";

type Principal = { orgId: string; userId: string };

const tickets = new Map<string, { p: Principal; exp: number }>();
const TTL_MS = 30_000;

export function issueWsTicket(p: Principal, now = Date.now()): string {
  const id = randomBytes(24).toString("base64url");
  tickets.set(id, { p, exp: now + TTL_MS });
  return id;
}

// Single-use: deletes on read; returns undefined if missing/expired.
export function redeemWsTicket(id: string, now = Date.now()): Principal | undefined {
  const t = tickets.get(id);
  if (!t) return undefined;
  tickets.delete(id);
  if (t.exp < now) return undefined;
  return t.p;
}
