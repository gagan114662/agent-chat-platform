CREATE TABLE IF NOT EXISTS "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
