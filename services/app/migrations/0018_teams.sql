CREATE TABLE IF NOT EXISTS "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_members" (
	"org_id" text NOT NULL,
	"team_id" text NOT NULL,
	"member_kind" text NOT NULL,
	"member_id" text NOT NULL,
	CONSTRAINT "team_members_org_id_team_id_member_kind_member_id_pk" PRIMARY KEY("org_id","team_id","member_kind","member_id")
);
