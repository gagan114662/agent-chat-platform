-- 0049_catalog_quotes (#152 2.1/2.2): the offer catalog + quotes. The price lives
-- in offerings once; a quote copies it at quote time (quoted_cents), and checkout
-- charges exactly that — the quote==charge guardrail (6.2) makes the number shown to
-- the customer equal to the number billed, killing the $15-vs-$33 class of bug.
CREATE TABLE IF NOT EXISTS offerings (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  deliverable text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT '',
  price_cents integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offerings_business_idx ON offerings (org_id, business_id);

CREATE TABLE IF NOT EXISTS quotes (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  offering_id text NOT NULL,
  customer text NOT NULL DEFAULT '',
  quoted_cents integer NOT NULL,
  state text NOT NULL DEFAULT 'open',
  payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_business_idx ON quotes (org_id, business_id);
