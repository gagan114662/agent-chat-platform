CREATE TABLE IF NOT EXISTS "thread_repos" (
	"org_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "thread_repos_org_id_thread_id_repo_id_pk" PRIMARY KEY("org_id","thread_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "forked_from" text;
