CREATE TABLE IF NOT EXISTS "run_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"run_id" text NOT NULL,
	"label" text NOT NULL,
	"branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
