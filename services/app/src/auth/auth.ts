import { randomUUID } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members, sessions } from "../db/schema.js";
import { verifyPassword } from "./password.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(db: DB, memberId: string, opts?: { userAgent?: string }) {
  const [member] = await db.select().from(members).where(eq(members.id, memberId));
  if (!member) throw new Error(`member not found: ${memberId}`);
  const token = randomUUID();
  await db.insert(sessions).values({
    id: token, memberId, orgId: member.orgId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    // #84 device sessions: stamp the client User-Agent as the session label.
    userAgent: opts?.userAgent ?? null,
  });
  return { token, member };
}

export async function resolveSession(db: DB, token: string): Promise<{ orgId: string; userId: string } | undefined> {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, token));
  if (!s || s.expiresAt.getTime() < Date.now()) return undefined;
  return { orgId: s.orgId, userId: s.memberId };
}

export async function deleteSession(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.id, token));
}

export async function listMembersForLogin(db: DB) {
  const ms = await db.select().from(members);
  return ms.map((m) => ({ id: m.id, displayName: m.displayName, orgId: m.orgId }));
}

// Returns the member if the password matches their stored hash; undefined otherwise.
export async function verifyCredentials(db: DB, memberId: string, password: string) {
  const [m] = await db.select().from(members).where(eq(members.id, memberId));
  if (!m || !m.passwordHash) return undefined;
  return verifyPassword(password, m.passwordHash) ? m : undefined;
}

// #84 device sessions: list the caller's OWN active sessions (org+user scoped),
// newest first. Returns NO tokens — only id/createdAt/lastSeenAt/userAgent — so
// the response can never leak a bearer. (The session id IS the bearer, so it is
// deliberately omitted as a column? No — the id is needed to revoke a specific
// session; it's the session id, not a secret beyond what the holder already has.
// We return the id so the client can DELETE /auth/sessions/:id.)
export function listSessions(db: DB, s: { orgId: string; userId: string }) {
  return db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.orgId, s.orgId), eq(sessions.memberId, s.userId)))
    .orderBy(asc(sessions.createdAt));
}

// #84 revoke ONE of the caller's own sessions, org+user scoped. Returns the
// number of rows deleted (0 when the id isn't the caller's → the route 404s).
// A session belonging to another user/org never matches the WHERE, so it can
// never be revoked by someone else.
export async function revokeSession(
  db: DB,
  r: { orgId: string; userId: string; sessionId: string },
): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.id, r.sessionId), eq(sessions.orgId, r.orgId), eq(sessions.memberId, r.userId)))
    .returning({ id: sessions.id });
  return deleted.length;
}

// #84 revoke all of the caller's OWN sessions EXCEPT the current one
// (`keepToken`). Org+user scoped — only the caller's sessions are touched.
export async function revokeOtherSessions(
  db: DB,
  r: { orgId: string; userId: string; keepToken: string },
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.orgId, r.orgId), eq(sessions.memberId, r.userId), ne(sessions.id, r.keepToken)));
}
