CREATE TABLE IF NOT EXISTS "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"seat_limit" integer NOT NULL,
	"agent_limit" integer NOT NULL,
	"message_quota" integer NOT NULL,
	"task_quota" integer NOT NULL,
	"stripe_price_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_sub_id" text,
	"current_period_end" timestamp with time zone
);
--> statement-breakpoint
-- Seed the pricing tiers (ascending limits; -1 = unlimited). Idempotent so the
-- migration is safe to re-run. Custom is contact-sales (unlimited, no price).
INSERT INTO "plans" ("id", "name", "seat_limit", "agent_limit", "message_quota", "task_quota", "stripe_price_id") VALUES
	('starter',    'Starter',    1,  1,   1000,    100,   NULL),
	('individual', 'Individual', 1,  3,   10000,   1000,  NULL),
	('pro',        'Pro',        10, 25,  100000,  10000, NULL),
	('growth',     'Growth',     50, 200, 1000000, 100000, NULL),
	('custom',     'Custom',     -1, -1,  -1,      -1,    NULL)
ON CONFLICT ("id") DO NOTHING;
