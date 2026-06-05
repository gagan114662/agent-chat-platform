-- 0037_payment_decisions (#114): append-only log of human decisions on gated
-- payments — the RLHF dataset + payment audit trail (#115). Idempotent.
CREATE TABLE IF NOT EXISTS payment_decisions (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  agent_id text,
  tool text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  recipient text,
  justification text NOT NULL DEFAULT '',
  decision text NOT NULL,
  modified_amount_cents integer,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_decisions_org_ix ON payment_decisions (org_id, created_at);
