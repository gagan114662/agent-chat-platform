import { describe, it, expect } from "vitest";
import { redactCreds } from "./redact.js";

describe("redactCreds", () => {
  it("redacts URL userinfo and bare tokens in sandbox-runner error text", () => {
    const out = redactCreds(
      "sandbox-runner 500: clone https://x-access-token:ghp_abc123@github.com/o/r.git failed",
    );
    expect(out).not.toContain("ghp_abc123");
    expect(out).not.toContain("x-access-token:ghp_abc123");
    // keeps the non-secret prefix
    expect(out).toContain("sandbox-runner 500: clone");
    expect(out).toContain("github.com/o/r.git failed");
  });

  it("redacts Bearer and token headers including JWT chars", () => {
    expect(redactCreds("Authorization: Bearer eyJhbGci.payload+sig/x==")).not.toContain("eyJhbGci");
    expect(redactCreds("Authorization: token abc.def-ghi")).not.toContain("abc.def-ghi");
  });

  it("leaves plain text untouched", () => {
    expect(redactCreds("plain error")).toBe("plain error");
  });
});
