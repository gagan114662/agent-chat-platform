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
  // #71 per-repo setup script: admin-configured (trusted config, NOT cloned-repo
  // content) shell script run in the sandbox workdir after clone and before the
  // agent (install deps / build). Nullable — null/empty = no setup (today's
  // behavior). Threaded app→orchestrator→sandbox; bounded by the run timeout.
  setupScript: text("setup_script"),
  // #73 per-repo environment variables: admin-configured (trusted config, NOT
  // cloned-repo content) key/value secrets threaded to the sandbox and applied
  // to the agent's child env (after the #49 scrub — an intentional admin
  // override) AND to the setup script (#71). Default {} = none (today's
  // behavior). Threaded app→orchestrator→sandbox.
  envVars: jsonb("env_vars").$type<Record<string, string>>().notNull().default({}),
  // #73 GitHub Enterprise base URL (e.g. "https://ghe.example.com/api/v3") used
  // by the Octokit client for GHE hosts. Nullable — null = github.com (today's
  // behavior). The clone host stays the repo URL itself (already host-agnostic).
  githubApiUrl: text("github_api_url"),
  // #139 production repo: a real product/own repo (not a throwaway). connectRepo
  // forces plan-first on these so merges go through the human gate (#125), not autopilot.
  production: boolean("production").notNull().default(false),
  // #140 deploy: an admin-configured command that ships the repo and prints
  // "ACP_DEPLOY_URL=<url>" (trusted config, run in the sandbox). liveUrl = the last
  // successful public URL. Nullable — no deploy configured = today's behavior.
  deployCommand: text("deploy_command"),
  liveUrl: text("live_url"),
});

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"), // 'admin' | 'member'
  passwordHash: text("password_hash"),
  // #84 magic-link: a member's login email. Nullable (existing members/invite
  // provisioning don't set it) — magic-link lookup matches on this when present.
  email: text("email"),
  // #84 TOTP MFA: the member's base32-encoded TOTP shared secret. Set by enroll
  // (not yet enforced); enforcement flips on only when `mfaEnabled` is true.
  // Nullable — members without MFA have none.
  totpSecret: text("totp_secret"),
  // #84 TOTP MFA: when true, login + magic-link verify require a valid TOTP code.
  // Off by default so existing logins are unchanged.
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
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
  avatarUrl: text("avatar_url"), // #91: optional avatar image URL (nullable)
  visibility: text("visibility").notNull().default("public"), // #91: public | private
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
  // #75 fork lineage: when a thread is created via forkThread, this records the
  // source thread id (a shallow fork copies the repo set + wiring, not messages).
  // Nullable — normally-created threads have none.
  forkedFrom: text("forked_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #75 thread_repos: a thread can reference many repos, exactly one of which is the
// primary (back-compat: mirrored from threads.repoId, and the fusion run dispatch
// still uses the primary). Org-scoped — both the thread and repo must be in the
// org. The composite PK (orgId, threadId, repoId) makes add idempotent.
export const threadRepos = pgTable("thread_repos", {
  orgId: text("org_id").notNull(),
  threadId: text("thread_id").notNull(),
  repoId: text("repo_id").notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.threadId, t.repoId] }) }));

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
  // #81 richer tasks: priority (none|low|medium|high|urgent) + a nullable due date.
  // Defaulted/nullable so existing task-create paths (openTaskForMention/bulk) stay untouched.
  priority: text("priority").notNull().default("none"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  // #137/#138: the goal this task advances (nullable — mention/manual tasks have none).
  goalId: text("goal_id"),
  createdByKind: text("created_by_kind").notNull(),
  createdById: text("created_by_id").notNull(),
});

// #81 task_comments: an org-scoped comment on a task, authored by a human or agent.
export const taskComments = pgTable("task_comments", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  taskId: text("task_id").notNull(),
  authorKind: text("author_kind").notNull(), // 'human' | 'agent'
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #81 task_relations: a directed link between two org tasks. `relation` is one of
// blocks|related|duplicate. The unique (orgId,fromTaskId,toTaskId,relation) index
// makes addTaskRelation idempotent (re-adding the same link is a no-op).
export const taskRelations = pgTable("task_relations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  fromTaskId: text("from_task_id").notNull(),
  toTaskId: text("to_task_id").notNull(),
  relation: text("relation").notNull(), // 'blocks' | 'related' | 'duplicate'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ux: uniqueIndex("task_relations_ux").on(t.orgId, t.fromTaskId, t.toTaskId, t.relation) }));

// #141/#142 a first-class business: bundles a repo (#139) + live URL (#140) + P&L
// + CRM + gated revenue/outreach. A workspace can hold many, each isolated.
export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  repoId: text("repo_id"),
  liveUrl: text("live_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Per-business revenue/cost lines → P&L.
export const businessLedger = pgTable("business_ledger", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  kind: text("kind").notNull(),            // 'revenue' | 'cost'
  amountCents: integer("amount_cents").notNull(),
  source: text("source").notNull(),        // 'payment' | 'agent_spend' | 'infra' | 'api' | 'manual'
  memo: text("memo").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A request to charge a customer — PENDING until a human approves (#110/#125).
export const paymentIntents = pgTable("payment_intents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  customer: text("customer").notNull().default(""),
  memo: text("memo").notNull().default(""),
  state: text("state").notNull().default("pending"), // 'pending'|'approved'|'declined'
  approvedBy: text("approved_by"),
  taskId: text("task_id"), // #146: the goal task that drafted this charge (approval → task done)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// CRM: a lead/customer in a business's funnel.
export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  identifier: text("identifier").notNull(),
  stage: text("stage").notNull().default("visitor"), // 'visitor'|'signup'|'customer'
  source: text("source").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A customer-acquisition campaign — PENDING until a human approves (high-stakes, #125).
export const outreachCampaigns = pgTable("outreach_campaigns", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  channel: text("channel").notNull(), // 'email'|'social'|'ads'
  audience: text("audience").notNull().default(""),
  body: text("body").notNull().default(""),
  state: text("state").notNull().default("pending"), // 'pending'|'approved'|'sent'|'declined'
  approvedBy: text("approved_by"),
  sentCount: integer("sent_count").notNull().default(0),
  taskId: text("task_id"), // #146: the goal task that drafted this campaign
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #152 2.1 the OFFER CATALOG: a typed definition of what a business sells. The
// price lives here, once — quotes derive from it, so a customer can never be
// shown a number that wasn't sourced from the catalog (the $15-vs-$33 class of bug).
export const offerings = pgTable("offerings", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  deliverable: text("deliverable").notNull().default(""),
  scope: text("scope").notNull().default(""),
  priceCents: integer("price_cents").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #152 2.2 a QUOTE: a price quoted to a customer, COPIED from an offering at quote
// time (never hand-entered). quotedCents is the single number shown to the customer;
// checkout (3.1) charges exactly this, asserted by the quote==charge guardrail (6.2).
export const quotes = pgTable("quotes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  offeringId: text("offering_id").notNull(),
  customer: text("customer").notNull().default(""),
  quotedCents: integer("quoted_cents").notNull(),
  state: text("state").notNull().default("open"), // 'open'|'charged'|'paid'|'expired'
  paymentIntentId: text("payment_intent_id"),     // set at internal (gated) checkout
  stripeSessionId: text("stripe_session_id"),      // set when a real Stripe Checkout Session is opened
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #152 5.1 DELIVERY: once a customer has paid + the work is complete, the
// deliverable is packaged and handed over (a deployed URL, a file, or access). A
// delivery is auto-created pending when a payment is approved, then fulfilled.
export const deliveries = pgTable("deliveries", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  customer: text("customer").notNull().default(""),
  paymentIntentId: text("payment_intent_id"),
  kind: text("kind").notNull().default("url"), // 'url'|'file'|'access'
  artifact: text("artifact").notNull().default(""), // the URL / file ref / access grant
  state: text("state").notNull().default("pending"), // 'pending'|'delivered'
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #152 7.1 SUPPORT: a post-sale customer message becomes a tracked ticket the agent
// (or a human) can act on — questions, revisions, refunds.
export const supportTickets = pgTable("support_tickets", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  customer: text("customer").notNull().default(""),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  state: text("state").notNull().default("open"), // 'open'|'resolved'
  resolution: text("resolution").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #41 GTM motion actions. The autonomous GTM runner records every action it takes
// here (and in the audit log) — autonomy without a human gate still means every send /
// asset / audit is traceable. `sent` is true only when a real connector delivered it;
// false means recorded-but-not-physically-sent (no operator connector wired yet).
export const gtmActions = pgTable("gtm_actions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  businessId: text("business_id").notNull(),
  fn: text("fn").notNull(),                 // GtmFunction
  skill: text("skill").notNull(),           // playbook id
  actionKind: text("action_kind").notNull(),
  summary: text("summary").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  sent: boolean("sent").notNull().default(false),
  reach: integer("reach").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #150.3 append-only, hash-chained audit log (tamper-evident). hash = sha256(
// prevHash + canonical(entry)); a broken link is detectable.
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  seq: integer("seq").notNull(),
  prevHash: text("prev_hash").notNull().default(""),
  hash: text("hash").notNull(),
  actorKind: text("actor_kind").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #148 prepaid credit ledger: append-only; balance = sum(deltaCents). Positive =
// top-up/grant, negative = metered agent compute.
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  deltaCents: integer("delta_cents").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  criteria: text("criteria").notNull().default(""), // done-criteria, one task per line (default planner)
  state: text("state").notNull().default("open"),    // 'open' | 'active' | 'done' | 'blocked'
  // #137 per-goal self-drive: when true, the unattended scheduler advances this
  // goal task-by-task with no human "Run now". #138 iterations: bounded next-step
  // generation / stuck-detection counter.
  autonomy: boolean("autonomy").notNull().default(false),
  iterations: integer("iterations").notNull().default(0),
  // #140: the public URL a deploy produced for this goal — lets a "live at a public
  // URL" success criterion auto-verify (#138). Nullable until a deploy succeeds.
  liveUrl: text("live_url"),
  // #146: when set, this goal advances a BUSINESS's funnel (its tasks run as
  // business actions — draft charge/campaign/signup → pending human approval) instead
  // of opening code PRs. Nullable — a normal code goal has none.
  businessId: text("business_id"),
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

// #80 files: an org-scoped uploaded file / typed artifact. The bytes live in a
// StorageBackend (local-disk now; S3/R2 later) under `storageKey`; the row is the
// metadata. `artifactKind` is inferred from contentType/extension at create time
// (code|document|markdown|image|other). `uploaded` flips true only after a valid
// signed PUT stores the bytes. Access is org-scoped (a foreign file id → 404).
export const files = pgTable("files", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  artifactKind: text("artifact_kind").notNull().default("other"), // code|document|markdown|image|other
  size: integer("size").notNull().default(0),
  storageKey: text("storage_key").notNull(),
  uploaded: boolean("uploaded").notNull().default(false),
  uploadedByKind: text("uploaded_by_kind").notNull(),
  uploadedById: text("uploaded_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgIx: index("files_org_ix").on(t.orgId) }));

// #88 invites: a token-hashed, org-scoped invitation to join an org/workspace at
// a given role. Only the sha256 hex `tokenHash` is stored — the plaintext
// `inv_…` token is returned ONCE at create time and never persisted or logged.
// `status` walks pending → accepted|revoked; `acceptedMemberId` links the member
// provisioned on accept. Accept only succeeds for a pending invite.
export const invites = pgTable("invites", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'accepted' | 'revoked'
  invitedById: text("invited_by_id").notNull(),
  acceptedMemberId: text("accepted_member_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tokenHashIx: index("invites_token_hash_ix").on(t.tokenHash) }));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  orgId: text("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // #84 device sessions: a human-readable label for the device/client (from the
  // login User-Agent). Nullable — existing/legacy sessions have none.
  userAgent: text("user_agent"),
  // #84 device sessions: best-effort last-activity marker, surfaced in the
  // session list. Defaults to now() at create; nullable for legacy rows.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
});

// #84 magic_links: a passwordless, one-time email login token. Only the sha256
// hex `tokenHash` of the plaintext `ml_…` token is stored — the plaintext is
// returned ONCE at request time (dev) / emailed (prod) and never persisted or
// logged. Single-use (`usedAt` flips on verify) and short-lived (`expiresAt`,
// 15min). verifyMagicLink succeeds only for an unused, unexpired token.
export const magicLinks = pgTable("magic_links", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tokenHashIx: index("magic_links_token_hash_ix").on(t.tokenHash) }));

export const memoryNodes = pgTable("memory_nodes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),                 // 'decision'|'fact'|'preference'|'identity'|'artifact'
  scope: text("scope").notNull().default("org"), // 'personal'|'project'|'team'|'org'
  label: text("label").notNull(),
  body: text("body").notNull().default(""),
  metadata: jsonb("metadata").notNull().default({}),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("active"), // 'active'|'invalidated'|'superseded'
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

// #98 automations: user-defined automations. A `trigger` (jsonb) is either a
// schedule (`{type:"schedule", everyMinutes}`) — fired from the #67 tick when
// `lastFiredAt` is older than `everyMinutes` (or null) — or an event
// (`{type:"event", event}` e.g. `outcome:checks_failed`) — fired from the fusion
// sink. The `action` (jsonb) either posts a message (`{type:"message", threadId,
// body}`) or starts an agent run (`{type:"run", threadId, agentId, intent}`).
// Org-scoped; `enabled` gates firing; `lastFiredAt` records the last schedule fire.
// #85 plans: the seeded pricing tiers. Reference data — rows are inserted by the
// 0027_billing migration (INSERT … ON CONFLICT DO NOTHING) and read by the
// billing module. Limits are integers; `-1` means unlimited. `stripePriceId` is
// the Stripe Price the Checkout Session is built from (nullable — e.g. the free
// Starter tier or a Custom/contact-sales tier has no self-serve price).
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),                       // 'starter' | 'individual' | 'pro' | 'growth' | 'custom'
  name: text("name").notNull(),
  seatLimit: integer("seat_limit").notNull(),
  agentLimit: integer("agent_limit").notNull(),
  messageQuota: integer("message_quota").notNull(),
  taskQuota: integer("task_quota").notNull(),
  stripePriceId: text("stripe_price_id"),
});

// #85 subscriptions: an org's current plan + Stripe linkage. One row per org
// (orgId is the PK). No row → the org is treated as the Starter (free) tier, so
// existing orgs keep working without a backfill. `status` walks active/…;
// Stripe ids are set once Checkout completes (webhook is a #103 follow-up).
export const subscriptions = pgTable("subscriptions", {
  orgId: text("org_id").primaryKey(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubId: text("stripe_sub_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});

export const automations = pgTable("automations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  trigger: jsonb("trigger").notNull().default({}),
  action: jsonb("action").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgIx: index("automations_org_ix").on(t.orgId) }));

// #69 contacts: public marketing-form lead capture. NO orgId — leads come from
// anonymous visitors via the landing contact form (POST /contact, a public
// route). `help` is the free-text message; `website` is the optional company URL.
export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  website: text("website"),
  help: text("help"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// #76 notes: a per-workspace, org-scoped note (title + body). Scoped by both
// orgId and workspaceId so listing is workspace-local and a cross-org id is
// invisible (the route maps that to 404). `createdById` records the author.
export const notes = pgTable("notes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ wsIx: index("notes_org_ws_ix").on(t.orgId, t.workspaceId) }));

// #99 persistent internal tools: a registry of agent/admin-built tools/dashboards
// stored as HTML content, org+workspace scoped, with a `published` flag. Content
// is rendered ONLY in a `sandbox=""` iframe on the client (scripts disabled) — it
// is stored verbatim. `createdByKind`/`createdById` record the author (a human
// member or an api-key principal `apikey:<id>` #83).
export const tools = pgTable("tools", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("page"),
  content: text("content").notNull().default(""),
  published: boolean("published").notNull().default(false),
  createdByKind: text("created_by_kind").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ wsIx: index("tools_org_ws_ix").on(t.orgId, t.workspaceId) }));

// #114 RLHF capture: every human decision on a gated payment (approve/decline/
// modify) is high-value labeled data — used to tune auto-approve thresholds and,
// later, fine-tune on the org's real risk tolerance. Append-only audit log (#115).
export const paymentDecisions = pgTable("payment_decisions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id"),
  tool: text("tool").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  recipient: text("recipient"),
  justification: text("justification").notNull().default(""),
  // 'approve' | 'decline' | 'modify'
  decision: text("decision").notNull(),
  modifiedAmountCents: integer("modified_amount_cents"),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgIx: index("payment_decisions_org_ix").on(t.orgId, t.createdAt) }));

// #118 inbound revenue: a treasury ledger (double-entry-ish: credit = money in,
// debit = money out) + invoices. The SOFTWARE side of "get paid" — live capture
// is via the billing/Stripe processor (#85) using the operator's account; this
// records what came in/out so the treasury balance + audit (#115) are first-class.
export const treasuryLedger = pgTable("treasury_ledger", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  direction: text("direction").notNull(), // 'credit' (in) | 'debit' (out)
  amountCents: integer("amount_cents").notNull(),
  source: text("source").notNull().default(""), // 'invoice' | 'subscription' | 'checkout' | 'agent_payout' | ...
  ref: text("ref"), // external id (invoice id, Stripe payment id, txn id)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ orgIx: index("treasury_ledger_org_ix").on(t.orgId, t.createdAt) }));

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  customer: text("customer").notNull().default(""),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("draft"), // draft | sent | paid | void
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => ({ orgIx: index("invoices_org_ix").on(t.orgId, t.status) }));

// #128 reputation: per-agent track record from verified run outcomes (merged =
// success; checks_failed/timeout/error = fail). Feeds capability matching (#127)
// and standing-permission thresholds. PK (orgId, agentId).
export const agentReputation = pgTable("agent_reputation", {
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  success: integer("success").notNull().default(0),
  fail: integer("fail").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.agentId] }) }));

// #130 auditable delegation chain: one row per hand-off (who delegated which task
// to whom). Lets any action be traced back to the accountable human (chain.ts).
export const delegationLinks = pgTable("delegation_links", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  taskId: text("task_id").notNull(),
  byKind: text("by_kind").notNull(),
  byId: text("by_id").notNull(),
  toKind: text("to_kind").notNull(),
  toId: text("to_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ taskIx: index("delegation_links_task_ix").on(t.orgId, t.taskId, t.at) }));

// #131 versioned, optimizable agent skill documents (external trainable state).
// Each save is a new version; the run injects the latest into the agent's intent.
export const skillDocuments = pgTable("skill_documents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  version: integer("version").notNull(),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ix: index("skill_documents_agent_ix").on(t.orgId, t.agentId, t.version) }));
