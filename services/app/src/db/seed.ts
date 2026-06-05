import { eq } from "drizzle-orm";
import { makeDb } from "./client.js";
import { orgs, workspaces, channels, threads, agents, repos, members } from "./schema.js";
import { hashPassword } from "../auth/password.js";
import { ensureDefaultAssistant } from "../agents/default-assistant.js";

const owner = process.env.E2E_REPO_OWNER ?? "gagan114662";
const repo = process.env.E2E_REPO_NAME ?? "acp-e2e-fixture";

const { db, sql } = makeDb();
await db.insert(orgs).values({ id: "o1", name: "Demo Org" }).onConflictDoNothing();
await db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "Demo" }).onConflictDoNothing();
await db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" }).onConflictDoNothing();
await db.update(members).set({ passwordHash: hashPassword(process.env.DEV_PASSWORD ?? "dev") }).where(eq(members.id, "m1"));
// Upsert so re-seeding repoints an existing r1 (e.g. fixture -> real demo repo) instead of leaving a stale binding.
await db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: owner, githubName: repo, defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" })
  .onConflictDoUpdate({ target: repos.id, set: { githubOwner: owner, githubName: repo, defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" } });
await db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }).onConflictDoNothing();
// Upsert so re-seeding an existing demo thread (from an earlier run) repairs its repo binding.
await db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1" })
  .onConflictDoUpdate({ target: threads.id, set: { channelId: "c1", repoId: "r1" } });
await db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} }).onConflictDoNothing();
// #87: every workspace gets a built-in @iris assistant out of the box (idempotent).
await ensureDefaultAssistant(db, { orgId: "o1", workspaceId: "w1" });
await sql.end();
console.log("seeded");
