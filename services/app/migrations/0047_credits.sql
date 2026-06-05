-- 0047_credits (#148): a prepaid credit ledger. Append-only; balance = sum(delta).
-- Positive deltas are top-ups/grants (real money in via the operator's processor),
-- negative deltas are metered agent compute. At/below zero, autonomy is suspended.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  delta_cents integer NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_org_ix ON credit_ledger (org_id, created_at);
