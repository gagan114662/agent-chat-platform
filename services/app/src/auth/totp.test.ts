import { describe, it, expect } from "vitest";
import { generateSecret, totpCode, verifyTotp } from "./totp.js";

describe("totp (RFC 6238, #84)", () => {
  it("generateSecret returns a base32 secret (decodes to 20 bytes)", () => {
    const s = generateSecret();
    // base32 alphabet only (no padding in our encoding)
    expect(s).toMatch(/^[A-Z2-7]+$/);
    // 20 bytes → 32 base32 chars (160 bits / 5)
    expect(s.length).toBe(32);
    // two calls differ (random)
    expect(generateSecret()).not.toBe(s);
  });

  it("totpCode is deterministic at a fixed now and 6 zero-padded digits", () => {
    const secret = generateSecret();
    const t = 1_700_000_000_000; // fixed instant
    const code = totpCode(secret, t);
    expect(code).toMatch(/^\d{6}$/);
    expect(totpCode(secret, t)).toBe(code); // deterministic
  });

  it("verifyTotp is self-consistent at a fixed now", () => {
    const secret = generateSecret();
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, t), t)).toBe(true);
  });

  it("accepts a code from the previous window (±1 clock skew)", () => {
    const secret = generateSecret();
    const t = 1_700_000_000_000;
    const prev = t - 30_000; // one 30s step earlier
    const prevCode = totpCode(secret, prev);
    // verifying the previous window's code at `t` still passes (skew tolerance)
    expect(verifyTotp(secret, prevCode, t)).toBe(true);
    // and the next window's code too
    const nextCode = totpCode(secret, t + 30_000);
    expect(verifyTotp(secret, nextCode, t)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateSecret();
    const t = 1_700_000_000_000;
    const code = totpCode(secret, t);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(verifyTotp(secret, wrong, t)).toBe(false);
  });

  it("rejects a code outside the ±1 window", () => {
    const secret = generateSecret();
    const t = 1_700_000_000_000;
    const far = totpCode(secret, t - 90_000); // 3 steps earlier — outside ±1
    expect(verifyTotp(secret, far, t)).toBe(false);
  });

  it("matches a known RFC-6238-style vector (base32 secret, SHA1)", () => {
    // The ASCII secret "12345678901234567890" base32-encoded; RFC 6238 SHA1 test
    // vector at T=59s → counter 1 → code 287082.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32 of the 20-byte ASCII
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
  });
});
