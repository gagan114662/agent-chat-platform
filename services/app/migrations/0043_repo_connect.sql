-- 0043_repo_connect (#139): connect arbitrary repos + mark production repos.
-- `production` repos are higher-stakes — connectRepo forces plan-first (the human
-- gate) on them so merges to a real product repo aren't autopilot. Idempotent.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS production boolean NOT NULL DEFAULT false;
