ALTER TABLE "threads" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "kind" text DEFAULT 'channel' NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "dm_peer_kind" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "dm_peer_id" text;