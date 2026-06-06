import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeSignature } from "./stripe-webhook.js";

const secret = "whsec_test";
const sign = (payload: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ type: "checkout.session.completed" });
  const now = 1_700_000_000;

  it("accepts a correctly-signed, fresh payload", () => {
    expect(verifyStripeSignature(secret, body, sign(body, now), 300, now)).toBe(true);
  });
  it("rejects a wrong signature", () => {
    expect(verifyStripeSignature(secret, body, `t=${now},v1=deadbeef`, 300, now)).toBe(false);
  });
  it("rejects a tampered payload", () => {
    expect(verifyStripeSignature(secret, body + "x", sign(body, now), 300, now)).toBe(false);
  });
  it("rejects a stale timestamp (replay)", () => {
    expect(verifyStripeSignature(secret, body, sign(body, now - 1000), 300, now)).toBe(false);
  });
  it("rejects when secret or header is missing", () => {
    expect(verifyStripeSignature(undefined, body, sign(body, now), 300, now)).toBe(false);
    expect(verifyStripeSignature(secret, body, undefined, 300, now)).toBe(false);
  });
});
