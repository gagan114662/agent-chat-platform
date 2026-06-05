CREATE TABLE IF NOT EXISTS "tools" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'page' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tools_org_ws_ix" ON "tools" USING btree ("org_id","workspace_id");
