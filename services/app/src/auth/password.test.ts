import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const h = hashPassword("s3cret");
    expect(h).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword("s3cret", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("produces distinct hashes for the same password (salted)", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
});
