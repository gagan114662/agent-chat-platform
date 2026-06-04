import { describe, it, expect } from "vitest";
import { issueWsTicket, redeemWsTicket } from "./ws-tickets.js";

describe("ws-tickets", () => {
  it("redeems a freshly issued ticket to its principal", () => {
    const id = issueWsTicket({ orgId: "o1", userId: "m1" });
    expect(redeemWsTicket(id)).toEqual({ orgId: "o1", userId: "m1" });
  });

  it("is single-use: a second redeem returns undefined", () => {
    const id = issueWsTicket({ orgId: "o1", userId: "m1" });
    expect(redeemWsTicket(id)).toEqual({ orgId: "o1", userId: "m1" });
    expect(redeemWsTicket(id)).toBeUndefined();
  });

  it("rejects an expired ticket", () => {
    const now = Date.now();
    const id = issueWsTicket({ orgId: "o1", userId: "m1" }, now);
    // 60s later (TTL is 30s) → expired.
    expect(redeemWsTicket(id, now + 60_000)).toBeUndefined();
  });

  it("returns undefined for an unknown id", () => {
    expect(redeemWsTicket("does-not-exist")).toBeUndefined();
  });
});
