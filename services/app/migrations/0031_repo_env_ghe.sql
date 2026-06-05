ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "env_vars" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "github_api_url" text;
