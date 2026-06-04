CREATE TABLE IF NOT EXISTS "log_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_events_org_ts_ix" ON "log_events" USING btree ("org_id","ts");
