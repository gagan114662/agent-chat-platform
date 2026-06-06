import { createHmac, timingSafeEqual } from "node:crypto";

// Verify a Stripe webhook signature (the `Stripe-Signature` header) over the RAW
// request body, per Stripe's scheme: header is `t=<ts>,v1=<hex>,...`; the signed
// payload is `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's signing secret.
// Constant-time compare; optional timestamp tolerance to blunt replay. No Stripe SDK.
export function verifyStripeSignature(
  secret: string | undefined,
  rawBody: Buffer | string,
  sigHeader: string | string[] | undefined,
  toleranceSec = 300,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !sigHeader) return false;
  const header = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=").map((s) => s.trim()) as [string, string]),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (toleranceSec > 0 && Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
