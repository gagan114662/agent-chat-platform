-- 0038_treasury (#118): inbound-revenue treasury ledger + invoices (software side
-- of "get paid"; live capture via the billing/Stripe processor). Idempotent.
CREATE TABLE IF NOT EXISTS treasury_ledger (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  direction text NOT NULL,
  amount_cents integer NOT NULL,
  source text NOT NULL DEFAULT '',
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treasury_ledger_org_ix ON treasury_ledger (org_id, created_at);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  customer text NOT NULL DEFAULT '',
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS invoices_org_ix ON invoices (org_id, status);
