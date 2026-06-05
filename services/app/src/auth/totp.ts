import { createHmac, randomBytes } from "node:crypto";

// #84 TOTP MFA — RFC 6238, hand-rolled on node crypto (no external lib).
// HMAC-SHA1 over the 8-byte big-endian time counter floor(now/1000/step),
// dynamic truncation → 6-digit zero-padded code. The shared secret is stored
// base32-encoded; we decode it to raw bytes for the HMAC.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
const DEFAULT_STEP = 30;

// generateSecret → 20 random bytes, base32-encoded (no padding). 20 bytes is the
// RFC-4226 recommended HMAC-SHA1 key length → 32 base32 characters.
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

// base32Encode encodes raw bytes to RFC-4648 base32 WITHOUT padding (uppercase).
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

// base32Decode decodes an RFC-4648 base32 string (case-insensitive, padding and
// non-alphabet whitespace tolerated) back to raw bytes for the HMAC key.
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip stray characters
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// counterBytes returns the 8-byte big-endian representation of a time counter.
function counterBytes(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  // counter fits comfortably in 53-bit safe integers; write as a big-endian u64.
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

// totpCode computes the RFC-6238 code for `secret` at `now` (ms) with `step`
// seconds. HMAC-SHA1 over the big-endian counter → dynamic truncation → 6-digit
// zero-padded string.
export function totpCode(secret: string, now: number = Date.now(), step: number = DEFAULT_STEP): string {
  const counter = Math.floor(now / 1000 / step);
  const key = base32Decode(secret);
  const hmac = createHmac("sha1", key).update(counterBytes(counter)).digest();
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

// verifyTotp returns true if `code` matches the TOTP for the current window or
// ±1 step (clock skew tolerance). Comparison is length-then-value to avoid throwing.
export function verifyTotp(secret: string, code: string, now: number = Date.now(), step: number = DEFAULT_STEP): boolean {
  if (!secret || !code) return false;
  const candidate = code.trim();
  for (const offset of [-1, 0, 1]) {
    if (totpCode(secret, now + offset * step * 1000, step) === candidate) return true;
  }
  return false;
}

// otpauthUri builds the standard otpauth:// URI an authenticator app scans as a QR.
export function otpauthUri(secret: string, account: string, issuer = "agent-chat-platform"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(DEFAULT_STEP) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
