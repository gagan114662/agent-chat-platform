import { pgTable, text, timestamp, integer, jsonb, boolean, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
});

export const repos = pgTable("repos", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  githubOwner: text("github_owner").notNull(),
  githubName: text("github_name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  tokenEnvVar: text("token_env_var").notNull(),
  autonomy: text("autonomy").notNull().default("autopilot-merge"), // 'monitor-only'|'resolve-ci'|'autopilot-merge'
  planMode: boolean("plan_mode").notNull().default(false), // #20: mentions on this repo plan-first (propose → approve → execute)
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // 'admin' | 'member'
  passwordHash: text("password_hash"),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  adapter: text("adapter").notNull().default("fake"),
  config: jsonb("config").notNull().default({}),
  shared: boolean("shared").notNull().default(false), // #28: shared agents run on any repo in their org
}, (t) => ({ handleUx: uniqueIndex("agents_org_handle_ux").on(t.orgId, t.handle) }));

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false), // #89: archived channels hidden from GET /channels by default
});

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  channelId: text("channel_id"),                       // nullable — DMs have no channel
  title: text("title").notNull(),
  repoId: text("repo_id"),
  kind: text("kind").notNull().default("channel"),     // 'channel' | 'dm'
  dmPeerKind: text("dm_peer_kind"),                    // 'human' | 'agent' (dm only)
  dmPeerId: text("dm_peer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  threadId: text("thread_id").notNull(),
  authorKind: text("author_kind").notNull(),
  authorId: text("author_id").notNull(),
  kind: text("kind").notNull().default("chat"),
  body: text("body").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  threadId: text("thread_id").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull().default("open"),
  assigneeKind: text("assignee_kind"),
  assigneeId: text("assignee_id"),
  createdByKind: text("created_by_kind").notNull(),
  createdById: text("created_by_id").notNull(),
});

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  criteria: text("criteria").notNull().default(""), // done-criteria, one task per line (default planner)
  state: text("state").notNull().default("open"),    // 'open' | 'active' | 'done'
  createdByKind: text("created_by_kind").notNull(),
  createdById: text("created_by_id").notNull(),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  taskId: text("task_id").notNull(),
  state: text("state").notNull().default("pending"),
  workflowId: text("workflow_id").notNull(),
  parentRunId: text("parent_run_id"), // #53 stacked PRs: a child (hand-off) run's parent — its PR bases on `agent/<parentRunId>`
  selected: boolean("selected").notNull().default(false), // #64 concurrent runs: the winning run among a task's siblings (exclusive)
  branch: text("branch"),
  commitSha: text("commit_sha"),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
});

export const runEvents = pgTable("run_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  runId: text("run_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ seqUx: uniqueIndex("run_events_run_seq_ux").on(t.runId, t.seq) }));

// #62 checkpoints: a named snapshot of {branch, commitSha} at a step in a run.
// The fusion sink records one whenever an event carries a commitSha. The id is
// deterministic (`${runId}:cp:${commitSha}`) so replays collapse (idempotent).
export const runCheckpoints = pgTable("run_checkpoints", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  runId: text("run_id").notNull(),
  label: text("label").notNull(),
  branch: text("branch").notNull(),
  commitSha: text("commit_sha").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #55 incidents: a security/observability incident detected from ingested
// telemetry (e.g. Cloudflare Logpush). The id is deterministic (`${orgId}:${key}`)
// so re-ingesting the same batch collapses (idempotent). `taskId` links the Task
// opened in the org's security thread (nullable when no thread is configured).
export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  source: text("source").notNull(),            // e.g. "cloudflare"
  severity: text("severity").notNull(),        // "low" | "medium" | "high"
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  raw: jsonb("raw").notNull().default({}),
  taskId: text("task_id"),                     // nullable — set when a Task is opened
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #95 log_events: the unified, any-source/any-format log store. Each ingested
// record (NDJSON / JSON-array / plain text line) normalizes to one row with a
// `level` + `message` + the original `raw`. Error-level rows derive incidents
// (reusing the #55 table). Indexed on (orgId, ts) for org-scoped recency queries.
export const logEvents = pgTable("log_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  source: text("source").notNull(),                 // e.g. "app", "nginx", "worker"
  level: text("level").notNull(),                    // "error" | "warn" | "info" | ...
  message: text("message").notNull(),
  raw: jsonb("raw").notNull().default({}),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgTsIx: index("log_events_org_ts_ix").on(t.orgId, t.ts) }));

// #61 read-state: per-user, per-thread read marker. `lastReadAt` is the
// timestamp the user last read the thread; messages with createdAt > lastReadAt
// are unread. No row for a (org,user,thread) → everything is unread. Org+user
// scoped. PRIMARY KEY (orgId, userId, threadId) makes mark-read an upsert.
export const readState = pgTable("read_state", {
  orgId: text("org_id").notNull(),
  userId: text("user_id").notNull(),
  threadId: text("thread_id").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.userId, t.threadId] }) }));

// #79 teams: a named group of members/agents in an org for bulk access +
// `@team` mentions. Org-scoped. `team_members` rows are typed (human|agent) and
// reference an existing member/agent id in the same org. The composite PK
// (orgId, teamId, memberKind, memberId) makes add idempotent and forbids dupes.
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  orgId: text("org_id").notNull(),
  teamId: text("team_id").notNull(),
  memberKind: text("member_kind").notNull(), // 'human' | 'agent'
  memberId: text("member_id").notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.teamId, t.memberKind, t.memberId] }) }));

// #83 api_keys: org-scoped, hashed, revocable API keys for agent authentication.
// Only the sha256 hex `keyHash` is stored — the plaintext `acp_…` key is returned
// ONCE at issue time and never persisted or logged. `scopes` records the key's
// channel/action grants (enforced via a requireScope follow-up). The auth
// preHandler resolves an `acp_`-prefixed bearer to a principal until `revoked`.
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  scopes: jsonb("scopes").notNull().default({}),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => ({ keyHashIx: index("api_keys_key_hash_ix").on(t.keyHash) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  orgId: text("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const memoryNodes = pgTable("memory_nodes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),                 // 'decision'|'fact'|'preference'|'identity'|'artifact'
  scope: text("scope").notNull().default("org"), // 'personal'|'project'|'team'|'org'
  label: text("label").notNull(),
  body: text("body").notNull().default(""),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memoryEdges = pgTable("memory_edges", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  relation: text("relation").notNull(),         // 'derived_from'|'relates_to'|'authored_by'|...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ux: uniqueIndex("memory_edges_ux").on(t.fromId, t.toId, t.relation) }));
