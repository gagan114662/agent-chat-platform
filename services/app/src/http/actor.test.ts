import { describe, it, expect } from "vitest";
import { actor } from "./actor.js";

describe("actor (fail-closed)", () => {
  it("throws unauthenticated when dev headers are not allowed and there is no principal", () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      expect(() => actor({ headers: {}, principal: undefined })).toThrow("unauthenticated");
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  });

  it("falls back to dev headers when ACP_ALLOW_DEV_HEADERS=1", () => {
    process.env.ACP_ALLOW_DEV_HEADERS = "1";
    expect(actor({ headers: { "x-org-id": "oX", "x-user-id": "mX" }, principal: undefined })).toEqual({
      orgId: "oX",
      userId: "mX",
    });
  });

  it("a principal always wins regardless of env", () => {
    delete process.env.ACP_ALLOW_DEV_HEADERS;
    try {
      expect(actor({ headers: {}, principal: { orgId: "oP", userId: "mP" } })).toEqual({
        orgId: "oP",
        userId: "mP",
      });
    } finally {
      process.env.ACP_ALLOW_DEV_HEADERS = "1";
    }
  });
});
