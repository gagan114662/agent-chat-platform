-- 0042_goal_autonomy (#137/#138): the unattended goal loop. Idempotent.
-- Link tasks back to the goal that spawned them, a per-goal self-drive flag, and
-- a bounded iteration counter for stuck-detection / next-step generation.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS goal_id text;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS autonomy boolean NOT NULL DEFAULT false;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS iterations integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tasks_goal_ix ON tasks (org_id, goal_id);
