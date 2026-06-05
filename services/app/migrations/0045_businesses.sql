-- 0045_businesses (#141/#142): a first-class business entity that bundles a repo
-- (#139) + deploy/live URL (#140) + per-business P&L + CRM + gated revenue/outreach.
-- HARD BOUNDARY: agents never move real money or message real people on their own —
-- payment intents and outreach campaigns are PENDING until a human approves them.
CREATE TABLE IF NOT EXISTS businesses (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  name text NOT NULL,
  repo_id text,
  live_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS businesses_org_ix ON businesses (org_id);

-- Per-business revenue + cost lines → P&L (revenue - cost = net).
CREATE TABLE IF NOT EXISTS business_ledger (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  kind text NOT NULL,            -- 'revenue' | 'cost'
  amount_cents integer NOT NULL,
  source text NOT NULL,          -- 'payment' | 'agent_spend' | 'infra' | 'api' | 'manual'
  memo text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_ledger_ix ON business_ledger (org_id, business_id);

-- A request to charge a customer. PENDING until a human approves (#110/#125); on
-- approval it posts a 'revenue' line. Agents create intents but cannot approve them.
CREATE TABLE IF NOT EXISTS payment_intents (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  amount_cents integer NOT NULL,
  customer text NOT NULL DEFAULT '',
  memo text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'declined'
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_intents_ix ON payment_intents (org_id, business_id, state);

-- CRM: a lead/customer in a business's funnel.
CREATE TABLE IF NOT EXISTS leads (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  identifier text NOT NULL,     -- email/handle/anon id
  stage text NOT NULL DEFAULT 'visitor', -- 'visitor' | 'signup' | 'customer'
  source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_ix ON leads (org_id, business_id, stage);

-- A customer-acquisition campaign. PENDING until a human approves; sending to real
-- people / spending ad budget is high-stakes (#125). Agents draft, humans approve.
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  channel text NOT NULL,        -- 'email' | 'social' | 'ads'
  audience text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'sent' | 'declined'
  approved_by text,
  sent_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_ix ON outreach_campaigns (org_id, business_id, state);
