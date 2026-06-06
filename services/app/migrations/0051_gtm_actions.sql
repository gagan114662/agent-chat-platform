-- 0051_gtm_actions (#41): the autonomous GTM motion records every action it takes —
-- autonomy without a human gate still means every send/asset/audit is traceable here
-- (and in the hash-chained audit log). `sent` is true only when a real connector
-- delivered it; false = recorded-but-not-physically-sent (no operator connector wired).
CREATE TABLE IF NOT EXISTS gtm_actions (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  business_id text NOT NULL,
  fn text NOT NULL,
  skill text NOT NULL,
  action_kind text NOT NULL,
  summary text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent boolean NOT NULL DEFAULT false,
  reach integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gtm_actions_business_idx ON gtm_actions (org_id, business_id);
