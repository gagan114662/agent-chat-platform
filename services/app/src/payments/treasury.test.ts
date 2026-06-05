import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { recordRevenue, recordDebit, treasuryBalanceCents, createInvoice, markInvoicePaid, listInvoices } from "./treasury.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("treasury (#118)", () => {
  it("balance = credits - debits, org-scoped", async () => {
    await recordRevenue(h.db, { orgId: "o1", amountCents: 10000, source: "checkout" });
    await recordDebit(h.db, { orgId: "o1", amountCents: 3000, source: "agent_payout" });
    await recordRevenue(h.db, { orgId: "o2", amountCents: 999, source: "checkout" }); // other org
    expect(await treasuryBalanceCents(h.db, "o1")).toBe(7000);
    expect(await treasuryBalanceCents(h.db, "o2")).toBe(999);
  });

  it("paying an invoice credits the treasury exactly once", async () => {
    const inv = await createInvoice(h.db, { orgId: "o1", customer: "Acme", amountCents: 5000 });
    expect((await listInvoices(h.db, "o1"))[0].status).toBe("draft");
    await markInvoicePaid(h.db, "o1", inv.id);
    expect(await treasuryBalanceCents(h.db, "o1")).toBe(5000);
    // Idempotent: paying again does not double-credit.
    await markInvoicePaid(h.db, "o1", inv.id);
    expect(await treasuryBalanceCents(h.db, "o1")).toBe(5000);
    const paid = (await listInvoices(h.db, "o1"))[0];
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBeTruthy();
  });

  it("zero balance with no entries", async () => {
    expect(await treasuryBalanceCents(h.db, "o1")).toBe(0);
  });
});
