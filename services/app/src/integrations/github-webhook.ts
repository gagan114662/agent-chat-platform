import { createHmac, timingSafeEqual } from "node:crypto";

// verifyGitHubSignature checks a GitHub webhook delivery's HMAC. GitHub signs the
// RAW request bytes with the webhook secret (sha256) and sends it as
// `X-Hub-Signature-256: sha256=<hex>`. We recompute over the same raw bytes and
// compare in constant time (timingSafeEqual) so the check can't be timed.
//
// Returns false (never throws) when the secret is unset, the header is missing /
// malformed, or the digest doesn't match — callers map false → 401.
export function verifyGitHubSignature(
  secret: string | undefined,
  rawBody: Buffer | string,
  sigHeader: string | string[] | undefined,
): boolean {
  if (!secret) return false;
  if (typeof sigHeader !== "string" || !sigHeader.startsWith("sha256=")) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  // timingSafeEqual requires equal-length buffers; bail (constant w.r.t. content)
  // when the lengths differ — a length mismatch already means no match.
  const a = Buffer.from(sigHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
