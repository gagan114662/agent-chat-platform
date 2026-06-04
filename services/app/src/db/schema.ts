import { pgTable, text, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
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
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // 'admin' | 'member'
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  handle: text("handle").notNull(),
  displayName: text("display_name").notNull(),
  adapter: text("adapter").notNull().default("fake"),
  config: jsonb("config").notNull().default({}),
}, (t) => ({ handleUx: uniqueIndex("agents_org_handle_ux").on(t.orgId, t.handle) }));

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
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

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  taskId: text("task_id").notNull(),
  state: text("state").notNull().default("pending"),
  workflowId: text("workflow_id").notNull(),
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

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  orgId: text("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
