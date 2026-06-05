CREATE TABLE IF NOT EXISTS "magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "magic_links_token_hash_ix" ON "magic_links" USING btree ("token_hash");
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "email" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone DEFAULT now();
