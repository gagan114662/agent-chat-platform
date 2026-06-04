CREATE TABLE IF NOT EXISTS "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"criteria" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" text NOT NULL
);
