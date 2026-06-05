-- 0048_audit_log (#150.3): append-only, hash-chained audit log. Each entry's hash
-- = sha256(prev_hash + canonical(entry)), so any tampering breaks the chain and is
-- detectable. Records every consequential agent/human action with its cause.
CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  seq integer NOT NULL,
  prev_hash text NOT NULL DEFAULT '',
  hash text NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_org_seq_ux ON audit_log (org_id, seq);
