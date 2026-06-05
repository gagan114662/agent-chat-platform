ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;
