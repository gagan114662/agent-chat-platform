-- 0046_goal_business (#146): a goal can target a BUSINESS, so the autonomy loop
-- advances its funnel (draft charges/campaigns/signups → pending, human-approved)
-- instead of only opening code PRs. Idempotent.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS business_id text;
-- payment_intents / outreach_campaigns can be traced back to the task that drafted
-- them, so approving the draft can mark that task verified (done).
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS task_id text;
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS task_id text;
