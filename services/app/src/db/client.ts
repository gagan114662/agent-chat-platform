import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof makeDb>["db"];

export function makeDb(url = process.env.DATABASE_URL ?? "postgres://acp:acp@localhost:5432/acp") {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

// Postgres NOTIFY caps the payload at 8000 bytes. A pr_card/plan_card message
// carries the full fusion-event metadata (plan text, PR/commit/diff), which can
// exceed that — pg_notify would throw and the broadcast (the live thread update,
// #144) would silently fail. So if the payload is too big, drop the heavy
// `metadata` from the broadcast copy (the client refetches full detail on demand);
// the core message still streams in live. Belt-and-suspenders: never let a notify
// error bubble up and break the request that triggered it.
const NOTIFY_LIMIT = 7500;
export async function notify(sql: postgres.Sql, channel: string, payload: unknown) {
  let body = JSON.stringify(payload);
  if (body.length > NOTIFY_LIMIT) {
    const p = payload as { threadId?: string; message?: Record<string, unknown> };
    if (p?.message && typeof p.message === "object") {
      body = JSON.stringify({ ...p, message: { ...p.message, metadata: { truncated: true } } });
    }
    if (body.length > NOTIFY_LIMIT) body = body.slice(0, 0) || JSON.stringify({ threadId: p?.threadId, message: { id: p?.message?.id, threadId: p?.threadId, truncated: true } });
  }
  try {
    await sql`select pg_notify(${channel}, ${body})`;
  } catch (err) {
    console.warn("[acp] pg_notify failed (live push skipped, clients refetch):", String(err));
  }
}
