-- 0040_delegation_links (#130): auditable delegation hand-offs. Idempotent.
CREATE TABLE IF NOT EXISTS delegation_links (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  task_id text NOT NULL,
  by_kind text NOT NULL,
  by_id text NOT NULL,
  to_kind text NOT NULL,
  to_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delegation_links_task_ix ON delegation_links (org_id, task_id, at);
