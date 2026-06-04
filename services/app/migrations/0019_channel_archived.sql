ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;
