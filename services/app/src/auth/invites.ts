import { randomBytes, createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { invites, members } from "../db/schema.js";
import { hashPassword } from "./password.js";

// #88 invites: org-scoped, token-hashed invitations. Only the sha256 hex of the
// plaintext `inv_…` token is stored. The plaintext token is returned ONCE by
// createInvite and is NEVER persisted or logged. accept resolves a token by its
// hash and provisions a member; it succeeds ONLY for a pending invite.

const PREFIX = "inv_";

// sha256 hex of the plaintext token — the only thing we persist.
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// createInvite generates a fresh `inv_<base64url>` token, stores ONLY its sha256
// hash with status pending, and returns the plaintext token ONCE. Callers MUST
// surface the plaintext to the inviter a single time and never persist/log it.
export async function createInvite(
  db: DB,
  i: { orgId: string; workspaceId: string; email: string; role?: string; byId: string },
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = PREFIX + randomBytes(24).toString("base64url");
  await db.insert(invites).values({
    id,
    orgId: i.orgId,
    workspaceId: i.workspaceId,
    email: i.email,
    role: i.role ?? "member",
    tokenHash: hash(token),
    status: "pending",
    invitedById: i.byId,
  });
  return { id, token };
}

// acceptInvite looks up a PENDING invite by its token hash (a revoked/accepted/
// unknown token → "invalid invite"), provisions a member in the invite's
// org/workspace at the invite's role, marks the invite accepted + links the new
// member, and returns the member. The password (if given) is hashed, never stored
// plaintext.
export async function acceptInvite(
  db: DB,
  a: { token: string; displayName: string; password?: string },
) {
  const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, hash(a.token)));
  if (!inv || inv.status !== "pending") throw new Error("invalid invite");

  const memberId = randomUUID();
  const [member] = await db.insert(members).values({
    id: memberId,
    orgId: inv.orgId,
    workspaceId: inv.workspaceId,
    displayName: a.displayName,
    role: inv.role,
    passwordHash: a.password ? hashPassword(a.password) : null,
  }).returning();

  await db.update(invites)
    .set({ status: "accepted", acceptedMemberId: memberId })
    .where(eq(invites.id, inv.id));

  return member;
}

// listInvites returns an org's PENDING invites WITHOUT the token hash or any
// secret — only id/email/role/workspaceId/invitedById/createdAt. The plaintext
// token is never retrievable after create.
export function listInvites(db: DB, orgId: string) {
  return db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      workspaceId: invites.workspaceId,
      status: invites.status,
      invitedById: invites.invitedById,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .where(and(eq(invites.orgId, orgId), eq(invites.status, "pending")))
    .orderBy(asc(invites.createdAt));
}

// revokeInvite sets status=revoked, org-scoped. A cross-org id is a no-op (the
// WHERE never matches), so another org can never revoke your invite. A revoked
// invite can no longer be accepted.
export async function revokeInvite(db: DB, r: { orgId: string; id: string }): Promise<void> {
  await db.update(invites)
    .set({ status: "revoked" })
    .where(and(eq(invites.id, r.id), eq(invites.orgId, r.orgId)));
}

// seatCount is the number of members in an org — the soft seat usage.
export async function seatCount(db: DB, orgId: string): Promise<number> {
  const rows = await db.select({ id: members.id }).from(members).where(eq(members.orgId, orgId));
  return rows.length;
}

// seatLimit is the soft seat cap from ACP_SEAT_LIMIT (default very large, i.e.
// effectively unlimited until #85 billing enforces a real quota).
export function seatLimit(): number {
  const v = process.env.ACP_SEAT_LIMIT;
  if (v === undefined || v === "") return 1_000_000;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1_000_000;
}
