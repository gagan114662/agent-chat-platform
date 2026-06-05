-- 0039_agent_reputation (#128): per-agent verified-outcome track record. Idempotent.
CREATE TABLE IF NOT EXISTS agent_reputation (
  org_id text NOT NULL,
  agent_id text NOT NULL,
  success integer NOT NULL DEFAULT 0,
  fail integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, agent_id)
);
