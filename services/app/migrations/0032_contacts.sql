CREATE TABLE IF NOT EXISTS "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"website" text,
	"help" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
