import postgres from "postgres";
import { makeDb } from "./client.js";

const TABLES = [
  "tools",
  "notes",
  "contacts",
  "subscriptions",
  "automations",
  "magic_links",
  "invites",
  "api_keys",
  "files",
  "sessions",
  "team_members", "teams",
  "read_state",
  "memory_edges", "memory_nodes",
  "log_events",
  "incidents",
  "task_relations", "task_comments",
  "thread_repos",
  "run_checkpoints", "run_events", "runs", "tasks", "messages", "threads", "channels",
  "agents", "members", "repos", "workspaces", "orgs",
];

export function testDb() {
  const { db, sql } = makeDb(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
  return { db, sql, async reset() { await sql.unsafe(`truncate ${TABLES.join(", ")} cascade`); } };
}

export async function closeDb(sql: postgres.Sql) { await sql.end(); }
