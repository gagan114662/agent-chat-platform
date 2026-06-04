CREATE TABLE IF NOT EXISTS "read_state" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "read_state_org_id_user_id_thread_id_pk" PRIMARY KEY("org_id","user_id","thread_id")
);
