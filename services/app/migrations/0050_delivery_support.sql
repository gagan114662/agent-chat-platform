-- 0050_delivery_support (#152 5.1/7.1): the fulfill→deliver handoff + post-sale
-- support. A delivery is auto-created pending when a payment is approved, then
-- fulfilled with the concrete artifact (the deployed URL by default). A support
-- ticket tracks a post-sale customer message an agent or human can act on.
CREATE TABLE IF NOT EXISTS deliveries (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  customer text NOT NULL DEFAULT '',
  payment_intent_id text,
  kind text NOT NULL DEFAULT 'url',
  artifact text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'pending',
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deliveries_business_idx ON deliveries (org_id, business_id);

CREATE TABLE IF NOT EXISTS support_tickets (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  customer text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open',
  resolution text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_business_idx ON support_tickets (org_id, business_id);
