# Treasury & legal setup (operator runbook) — #117

**This is a checklist of real-world actions only you can take.** The platform
cannot (and must not) form a legal entity, open or fund bank accounts, complete
KYC, or move real money on your behalf. The software is ready to *record* and
*gate* money once these are in place — see the "wired and waiting" section.

## Why a human does this
Forming a company, funding a treasury, and processing real payments require legal
identity, signatures, and accountability that belong to a person/organization, not
an autonomous agent. The agent platform sits *behind* these: it proposes payments,
a human approves money (the #110 gate), and every decision is logged (#114/#115).

## Steps you take (with your lawyer/accountant as needed)

1. **Form the legal entity.** Choose a structure (LLC / C-corp) and jurisdiction;
   file formation; get an operating agreement. (Lawyer or a service like Stripe
   Atlas / Clerky.)
2. **EIN / tax registration.** Obtain the federal tax ID and any state
   registrations.
3. **Business bank account.** Open it under the entity; you are the signer.
4. **Payment processor (inbound).** Create the processor account (Stripe is already
   integrated, #85) under the entity; complete its KYC/onboarding; get the live
   API keys + the lower-tier **price IDs** (also unblocks #107 self-serve).
5. **Treasury / custody (outbound, optional).** If agents will *send* funds: a
   custody/issuer provider (card issuer such as Stripe Issuing/Lithic, or an L2
   stablecoin wallet). Complete its KYC; fund it from the business account.
6. **Fund the treasury.** Move an initial, bounded float — never more than you'd
   accept an agent spending behind the gate.
7. **Set the gate policy.** Configure the money-gate JSON policy
   (`autoApproveUnderCents`, `sanctionedRecipients`) conservatively to start
   (default: every payment needs a human).

## Wired and waiting (the software side, already built)

- **Inbound revenue (#118):** `services/app/src/payments/treasury.ts` —
  `createInvoice`, `markInvoicePaid` (credits the treasury once, idempotent),
  `recordRevenue`, `treasuryBalanceCents`. Connect your processor's
  paid/settled webhook (#85 billing routes) to `markInvoicePaid` / `recordRevenue`.
- **Outbound rails behind the gate (#113):**
  `services/sandbox-runner/internal/payments` — implement the `Provider` interface
  with your custody/issuer keys; wrap it in `GatedProvider` so every transfer/card
  hits the money gate (#110) first.
- **The gate (#110):** `internal/paymentgate` (decide) + `internal/mcpproxy`
  (enforce on the wire) + `internal/mcprbac` (role authorization). Implement the
  `Approver` against the app's held_for_human approval card.
- **Audit/RLHF (#114/#115):** `payment_decisions` table + `payments/decisions.ts`
  + `payments/reconcile.ts` — every approve/decline is logged and reconciled
  against executed transfers.

Once steps 1–7 are done and the processor webhook is pointed at `markInvoicePaid`,
revenue flows into the treasury ledger and agent spending flows out only through
the human gate. No code change is required to *start* — only your accounts + keys.
