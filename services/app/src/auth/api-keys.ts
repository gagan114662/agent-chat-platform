import { randomBytes, createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { apiKeys } from "../db/schema.js";

// #83 api keys: org-scoped, hashed, revocable API keys for agent auth. Only the
// sha256 hex of the plaintext key is stored. The plaintext `acp_…` key is
// returned ONCE by issueApiKey and is NEVER stored or logged. The auth
// preHandler resolves an `acp_`-bearer to a principal via resolveApiKey.

export type Scopes = Record<string, unknown>;
export type ApiKeyPrincipal = { orgId: string; userId: string; scopes: Scopes };

const PREFIX = "acp_";

// sha256 hex of the plaintext key — the only thing we persist.
function hash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// issueApiKey generates a fresh `acp_<base64url>` key, stores ONLY its sha256
// hash, and returns the plaintext key ONCE. Callers MUST surface the plaintext
// to the user a single time and never persist/log it.
export async function issueApiKey(
  db: DB,
  i: { orgId: string; name: string; scopes?: Scopes; userId: string },
): Promise<{ id: string; key: string; name: string }> {
  const id = randomUUID();
  const key = PREFIX + randomBytes(24).toString("base64url");
  await db.insert(apiKeys).values({
    id,
    orgId: i.orgId,
    name: i.name,
    keyHash: hash(key),
    scopes: i.scopes ?? {},
  });
  return { id, key, name: i.name };
}

// resolveApiKey looks up a plaintext key by its hash. Returns the api-key
// principal iff the key exists and is NOT revoked; otherwise undefined (so a
// bad/revoked key yields no principal → #37 fail-closed default-deny). Best-effort
// stamps lastUsedAt (a failed stamp never blocks resolution).
export async function resolveApiKey(db: DB, key: string): Promise<ApiKeyPrincipal | undefined> {
  if (!key.startsWith(PREFIX)) return undefined;
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash(key)));
  if (!row || row.revoked) return undefined;
  try {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  } catch {
    // best-effort: never let a lastUsedAt write failure deny a valid key
  }
  return { orgId: row.orgId, userId: `apikey:${row.id}`, scopes: (row.scopes ?? {}) as Scopes };
}

// revokeApiKey sets revoked=true, org-scoped. A cross-org id is a no-op (the
// WHERE never matches), so another org can never revoke your key.
export async function revokeApiKey(db: DB, r: { orgId: string; id: string }): Promise<void> {
  await db.update(apiKeys).set({ revoked: true }).where(and(eq(apiKeys.id, r.id), eq(apiKeys.orgId, r.orgId)));
}

// listApiKeys returns an org's keys WITHOUT the hash or any secret — only
// id/name/scopes/revoked/createdAt/lastUsedAt. The plaintext key is never
// retrievable after issue.
export function listApiKeys(db: DB, orgId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      revoked: apiKeys.revoked,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId))
    .orderBy(asc(apiKeys.createdAt));
}
