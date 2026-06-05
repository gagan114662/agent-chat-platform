-- 0044_deploy (#140): a deploy target per repo + the last live URL, and the live
-- URL recorded on a goal so a "live at a public URL" criterion can auto-verify (#138).
ALTER TABLE repos ADD COLUMN IF NOT EXISTS deploy_command text;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS live_url text;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS live_url text;
