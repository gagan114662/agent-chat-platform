ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "priority" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "due_date" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_id" text NOT NULL,
	"author_kind" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_relations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_task_id" text NOT NULL,
	"to_task_id" text NOT NULL,
	"relation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_relations_ux" ON "task_relations" USING btree ("org_id","from_task_id","to_task_id","relation");
