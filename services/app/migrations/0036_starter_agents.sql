-- 0036_starter_agents: the Starter (free) tier allows 3 agents — matching the
-- reference free plan — so a fresh org with the built-in assistant (#87) plus one
-- agent isn't immediately flagged "over" on agents (#107). Idempotent.
UPDATE plans SET agent_limit = 3 WHERE id = 'starter' AND agent_limit < 3;
