import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { magicLinks, members } from "../db/schema.js";
import { createSession } from "./auth.js";

// #84 magic-link: passwordless email login. A request mints a one-time `ml_…`
// token, stores ONLY its sha256 hex hash (the plaintext is returned ONCE in dev /
// emailed in prod, never persisted or logged), and is single-use + 15min TTL.
// verifyMagicLink resolves an unused, unexpired token by its hash, marks it used,
// and issues a session. The member is identified by `members.email` (#84 added the
// column); an unknown email is a silent no-op so the request can't enumerate users.

const PREFIX = "ml_";
const TTL_MS = 15 * 60 * 1000;

// sha256 hex of the plaintext token — the only thing we persist.
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// requestMagicLink finds the member by email, mints a fresh `ml_<base64url>`
// token, stores ONLY its hash with a 15-min expiry, and returns the plaintext
// token ONCE (the route surfaces it only in dev; prod emails it). An unknown
// email yields `{ token: undefined }` with no row written (no user enumeration).
export async function requestMagicLink(
  db: DB,
  i: { email: string },
): Promise<{ token?: string }> {
  const email = i.email.trim().toLowerCase();
  if (!email) return {};
  const [member] = await db.select().from(members).where(eq(members.email, email));
  if (!member) return {}; // no enumeration — caller always responds 200

  const token = PREFIX + randomBytes(24).toString("base64url");
  await db.insert(magicLinks).values({
    id: randomUUID(),
    memberId: member.id,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return { token };
}

// peekMagicLinkMember resolves the member behind a magic-link token WITHOUT
// consuming it (used by the #84 MFA gate so a failed MFA attempt doesn't burn the
// single-use token). Returns the member id only for an unused, unexpired token.
export async function peekMagicLinkMember(
  db: DB,
  v: { token: string; now?: number },
): Promise<string | undefined> {
  const now = v.now ?? Date.now();
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash(v.token)));
  if (!link || link.usedAt || link.expiresAt.getTime() < now) return undefined;
  return link.memberId;
}

// verifyMagicLink looks up a magic-link by its token hash. It succeeds ONLY for a
// token that is unused (`usedAt` null) and unexpired (`expiresAt` > now); anything
// else throws "invalid or expired". On success it marks the link used (single-use)
// and issues a session for the member. `now` is injectable for testing the clock.
export async function verifyMagicLink(
  db: DB,
  v: { token: string; now?: number; userAgent?: string },
): Promise<{ token: string; member: typeof members.$inferSelect }> {
  const now = v.now ?? Date.now();
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hash(v.token)));
  if (!link || link.usedAt || link.expiresAt.getTime() < now) {
    throw new Error("invalid or expired");
  }
  // Single-use: mark used atomically-guarded by the usedAt IS NULL we already
  // checked. createSession also re-validates the member exists.
  await db.update(magicLinks).set({ usedAt: new Date(now) }).where(eq(magicLinks.id, link.id));
  const { token, member } = await createSession(db, link.memberId, { userAgent: v.userAgent });
  return { token, member };
}
