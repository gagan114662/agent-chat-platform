import { describe, it, expect, beforeEach } from "vitest";
import { allow, _reset } from "./rate-limit.js";

describe("rate-limit fixed-window limiter", () => {
  beforeEach(() => { _reset(); });

  it("allows up to the limit then denies", () => {
    const key = "k";
    for (let i = 0; i < 5; i++) expect(allow(key, 5, 60_000)).toBe(true);
    expect(allow(key, 5, 60_000)).toBe(false);
  });

  it("allows again after the window elapses", () => {
    const key = "k";
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(allow(key, 5, 60_000, now)).toBe(true);
    expect(allow(key, 5, 60_000, now)).toBe(false);
    expect(allow(key, 5, 60_000, now + 61_000)).toBe(true);
  });

  it("tracks distinct keys independently", () => {
    for (let i = 0; i < 5; i++) expect(allow("a", 5, 60_000)).toBe(true);
    expect(allow("a", 5, 60_000)).toBe(false);
    // a different key is unaffected
    expect(allow("b", 5, 60_000)).toBe(true);
  });
});
