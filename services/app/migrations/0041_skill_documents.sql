-- 0041_skill_documents (#131): versioned agent skill docs. Idempotent.
CREATE TABLE IF NOT EXISTS skill_documents (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  agent_id text NOT NULL,
  version integer NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_documents_agent_ix ON skill_documents (org_id, agent_id, version);
