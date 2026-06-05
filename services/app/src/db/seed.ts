import { eq } from "drizzle-orm";
import { makeDb } from "./client.js";
import { orgs, workspaces, channels, threads, agents, repos, members, subscriptions } from "./schema.js";
import { hashPassword } from "../auth/password.js";
import { ensureDefaultAssistant } from "../agents/default-assistant.js";

const owner = process.env.E2E_REPO_OWNER ?? "gagan114662";
const repo = process.env.E2E_REPO_NAME ?? "acp-e2e-fixture";

const { db, sql } = makeDb();
await db.insert(orgs).values({ id: "o1", name: "Demo Org" }).onConflictDoNothing();
await db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "Demo" }).onConflictDoNothing();
await db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You", role: "admin" }).onConflictDoNothing();
// m1 is the sole operator/owner — give it admin so it can manage agents, teams,
// skills, and api keys (member role lacks agent:share et al). Re-seed promotes it.
await db.update(members).set({ passwordHash: hashPassword(process.env.DEV_PASSWORD ?? "dev"), role: "admin" }).where(eq(members.id, "m1"));
// Upsert so re-seeding repoints an existing r1 (e.g. fixture -> real demo repo) instead of leaving a stale binding.
await db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: owner, githubName: repo, defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" })
  .onConflictDoUpdate({ target: repos.id, set: { githubOwner: owner, githubName: repo, defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" } });
await db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }).onConflictDoNothing();
// Upsert so re-seeding an existing demo thread (from an earlier run) repairs its repo binding.
await db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1" })
  .onConflictDoUpdate({ target: threads.id, set: { channelId: "c1", repoId: "r1" } });
// The demo workspace is on Pro so it can hold a real multi-agent roster (Starter
// caps agents at 3). Upsert so re-seeding keeps it.
await db.insert(subscriptions).values({ orgId: "o1", planId: "pro", status: "active" })
  .onConflictDoUpdate({ target: subscriptions.orgId, set: { planId: "pro", status: "active" } });
await db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} }).onConflictDoNothing();
// A reload.chat-style roster out of the box: one agent per first-party adapter.
// Their CLIs must be installed + credentialed on the sandbox to actually run (#91).
const roster = [
  { id: "a-cursor", handle: "cursor", displayName: "Cursor", adapter: "cursor" },
  { id: "a-devin", handle: "devin", displayName: "Devin", adapter: "devin" },
  { id: "a-openclaw", handle: "openclaw", displayName: "Openclaw", adapter: "openclaw" },
  { id: "a-hermes", handle: "hermes", displayName: "Hermes", adapter: "hermes" },
];
for (const a of roster) {
  await db.insert(agents).values({ orgId: "o1", workspaceId: "w1", config: {}, ...a }).onConflictDoNothing();
}
// #87: every workspace gets a built-in @iris assistant out of the box (idempotent).
await ensureDefaultAssistant(db, { orgId: "o1", workspaceId: "w1" });

// --- A rich, alive demo workspace (reload.chat-style): real channels, a live
// product-launch conversation, and a populated task board. Idempotent. ---
const demoChannels = [
  { id: "c-eng", name: "engineering" }, { id: "c-design", name: "design" },
  { id: "c-product", name: "product" }, { id: "c-marketing", name: "marketing" },
  { id: "c-sales", name: "sales" }, { id: "c-qa", name: "qa" },
  { id: "c-releases", name: "releases" },
];
for (const c of demoChannels) {
  await db.insert(channels).values({ id: c.id, orgId: "o1", workspaceId: "w1", name: c.name }).onConflictDoNothing();
}
// Real structure (channels per function) so the workspace isn't a single empty
// room — but NO canned conversation. Activity here is real: dispatch an agent and
// watch the run stream in (the thread updates live, #144). One thread per channel
// so each opens to a usable, repo-bound room.
const fnThreads = [
  { id: "th-eng", channelId: "c-eng", title: "backend" },
  { id: "th-design", channelId: "c-design", title: "design-system" },
  { id: "th-product", channelId: "c-product", title: "launch-v2" },
  { id: "th-qa", channelId: "c-qa", title: "release-qa" },
];
for (const t of fnThreads) {
  await db.insert(threads).values({ id: t.id, orgId: "o1", channelId: t.channelId, title: t.title, repoId: "r1" })
    .onConflictDoUpdate({ target: threads.id, set: { channelId: t.channelId, repoId: "r1" } });
}

await sql.end();
console.log("seeded");
