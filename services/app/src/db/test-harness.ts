import postgres from "postgres";
import { makeDb } from "./client.js";

const TABLES = [
  "sessions",
  "memory_edges", "memory_nodes",
  "run_checkpoints", "run_events", "runs", "tasks", "messages", "threads", "channels",
  "agents", "members", "repos", "workspaces", "orgs",
];

export function testDb() {
  const { db, sql } = makeDb(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
  return { db, sql, async reset() { await sql.unsafe(`truncate ${TABLES.join(", ")} cascade`); } };
}

export async function closeDb(sql: postgres.Sql) { await sql.end(); }
