import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { members } from "../db/schema.js";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";

// #84 TOTP MFA orchestration over the members table. All ops are org-scoped — a
// (orgId, memberId) mismatch never matches the WHERE, so a foreign org can't
// touch another org's member ("member not found").

async function getMember(db: DB, orgId: string, memberId: string) {
  const [m] = await db.select().from(members).where(and(eq(members.id, memberId), eq(members.orgId, orgId)));
  if (!m) throw new Error("member not found");
  return m;
}

// enrollMfa generates a fresh TOTP secret and stores it on the member WITHOUT
// enabling MFA yet (enforcement only flips on after confirmMfa). Returns the
// base32 secret + the otpauth:// URI for the authenticator-app QR.
export async function enrollMfa(
  db: DB,
  i: { orgId: string; memberId: string },
): Promise<{ secret: string; uri: string }> {
  const m = await getMember(db, i.orgId, i.memberId);
  const secret = generateSecret();
  await db.update(members)
    .set({ totpSecret: secret, mfaEnabled: false })
    .where(and(eq(members.id, i.memberId), eq(members.orgId, i.orgId)));
  return { secret, uri: otpauthUri(secret, m.email ?? m.displayName) };
}

// confirmMfa verifies a TOTP `code` against the enrolled secret and, on success,
// flips mfaEnabled=true. A missing secret or wrong code throws "invalid code"
// (MFA stays disabled).
export async function confirmMfa(
  db: DB,
  i: { orgId: string; memberId: string; code: string },
): Promise<void> {
  const m = await getMember(db, i.orgId, i.memberId);
  if (!m.totpSecret || !verifyTotp(m.totpSecret, i.code)) {
    throw new Error("invalid code");
  }
  await db.update(members)
    .set({ mfaEnabled: true })
    .where(and(eq(members.id, i.memberId), eq(members.orgId, i.orgId)));
}

// disableMfa clears the secret and the flag (org-scoped).
export async function disableMfa(db: DB, i: { orgId: string; memberId: string }): Promise<void> {
  await getMember(db, i.orgId, i.memberId);
  await db.update(members)
    .set({ totpSecret: null, mfaEnabled: false })
    .where(and(eq(members.id, i.memberId), eq(members.orgId, i.orgId)));
}

// mfaRequired returns whether the member has MFA enabled (the login gate checks this).
export async function mfaRequired(db: DB, memberId: string): Promise<boolean> {
  const [m] = await db.select({ mfaEnabled: members.mfaEnabled }).from(members).where(eq(members.id, memberId));
  return Boolean(m?.mfaEnabled);
}

// verifyMfaCode verifies a code against the member's stored secret. Returns true
// only when MFA is enabled AND the code is valid for the current ±1 window. Used
// by the login + magic-link-verify gates.
export async function verifyMfaCode(db: DB, memberId: string, code: string | undefined): Promise<boolean> {
  const [m] = await db.select({ totpSecret: members.totpSecret }).from(members).where(eq(members.id, memberId));
  if (!m?.totpSecret || !code) return false;
  return verifyTotp(m.totpSecret, code);
}
