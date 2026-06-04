import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGitHubSignature } from "./github-webhook.js";

const SECRET = "whsec-test-123";
const BODY = JSON.stringify({ action: "opened", hello: "world" });

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGitHubSignature", () => {
  it("verifies a correct sha256 signature over the raw body", () => {
    expect(verifyGitHubSignature(SECRET, BODY, sign(SECRET, BODY))).toBe(true);
  });

  it("accepts a Buffer raw body (what the parser keeps)", () => {
    const buf = Buffer.from(BODY, "utf8");
    expect(verifyGitHubSignature(SECRET, buf, sign(SECRET, BODY))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign(SECRET, BODY);
    const tampered = JSON.stringify({ action: "opened", hello: "evil" });
    expect(verifyGitHubSignature(SECRET, tampered, sig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyGitHubSignature(SECRET, BODY, sign("other-secret", BODY))).toBe(false);
  });

  it("returns false when the secret is unset", () => {
    expect(verifyGitHubSignature(undefined, BODY, sign(SECRET, BODY))).toBe(false);
    expect(verifyGitHubSignature("", BODY, sign(SECRET, BODY))).toBe(false);
  });

  it("returns false when the header is missing or malformed", () => {
    expect(verifyGitHubSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyGitHubSignature(SECRET, BODY, ["a", "b"])).toBe(false);
    // a bare hex digest without the sha256= prefix is malformed
    expect(verifyGitHubSignature(SECRET, BODY, createHmac("sha256", SECRET).update(BODY).digest("hex"))).toBe(false);
  });
});
