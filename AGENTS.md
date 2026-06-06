# AGENTS.md — Working agreement for all agents on agent-chat-platform

## The one hard rule: no issue closes without a verified outcome
An issue may be closed ONLY by a merged Pull Request that passes the #156 evals/guardrails gate.
Do NOT self-close issues. Do NOT close work by pushing directly to `main`. "I wrote the code" is not "done."

## Definition of Done (applies to every issue)
1. Work lands as a PR (never a direct push to `main`).
2. The PR passes the #156 blocking gate: quote == charge, no placeholder/dead links, and the
   Null-Agent / Random-Agent grader test (a no-op or random agent MUST score 0 — if it scores
   above 0 the grader is broken).
3. The issue's own acceptance criteria are demonstrably met, with evidence linked in the PR
   (logs, screenshots, or live cache-busted URLs).
4. Anything touching money links a real Stripe (livemode) artifact as proof — a Checkout Session,
   PaymentIntent, or charge. Test customers (@test.com, @x.com) and simulated charges DO NOT count.

## Prohibited
- Closing an issue with no linked PR (PRs=0).
- Marking any revenue / checkout / pricing issue done without a real livemode Stripe artifact.
- Shipping a catalog price with a null or zero unit_amount.

## North star
Profit = one real external customer completing a livemode Stripe payment where revenue exceeds that
sale's cost (see #166 / #170). A green checkmark is not revenue.

Until the #156 gate is live and enforcing in CI, treat the above as mandatory self-discipline.
The overseer will REOPEN any issue closed without the evidence required here.
