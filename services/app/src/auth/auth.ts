import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
