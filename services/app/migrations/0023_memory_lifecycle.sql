ALTER TABLE "memory_nodes" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_nodes" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;
