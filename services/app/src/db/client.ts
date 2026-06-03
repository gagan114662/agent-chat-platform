import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof makeDb>["db"];

export function makeDb(url = process.env.DATABASE_URL ?? "postgres://acp:acp@localhost:5432/acp") {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export async function notify(sql: postgres.Sql, channel: string, payload: unknown) {
  await sql`select pg_notify(${channel}, ${JSON.stringify(payload)})`;
}
