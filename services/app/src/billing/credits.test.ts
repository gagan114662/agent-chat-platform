import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import { balanceCents, topUp, meter, affordableMaxTokens, preflight } from "./credits.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); await h.db.insert(orgs).values({ id: "o1", name: "O" }); });

describe("credit ledger (#148)", () => {
  it("balance = sum of deltas; top-up adds, meter subtracts", async () => {
    expect(await balanceCents(h.db, "o1")).toBe(0);
    await topUp(h.db, "o1", 1000, "purchase");
    expect(await balanceCents(h.db, "o1")).toBe(1000);
    await meter(h.db, "o1", 250, "run x");
    expect(await balanceCents(h.db, "o1")).toBe(750);
  });
});

describe("pre-flight token budgeting (#148.1.2)", () => {
  it("affordableMaxTokens = balance / output price", () => {
    // $1.00 balance, $0.006/1k output → ~166k tokens affordable
    expect(affordableMaxTokens(100, 0.006)).toBe(166666);
    expect(affordableMaxTokens(0, 0.006)).toBe(0);
  });
  it("preflight caps to what's affordable and refuses at zero balance (no raw 402)", () => {
    // plenty of balance → requested cap honored
    expect(preflight(1000, 0.006, 500)).toMatchObject({ ok: true, maxTokens: 500 });
    // tiny balance → capped below the request
    const tiny = preflight(1, 0.006, 100000);
    expect(tiny.ok).toBe(true);
    expect(tiny.maxTokens).toBeLessThan(100000);
    // zero balance → refused with a clean top-up message, never executed
    const broke = preflight(0, 0.006, 500);
    expect(broke.ok).toBe(false);
    expect(broke.reason).toMatch(/top up/i);
    // metering off → always ok
    expect(preflight(0, 0.006, 500, { metered: false })).toMatchObject({ ok: true, maxTokens: 500 });
  });
});
