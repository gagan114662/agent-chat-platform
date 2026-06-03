import { makeDb } from "./client.js";
import { orgs, workspaces, channels, threads, agents, repos, members } from "./schema.js";

const owner = process.env.E2E_REPO_OWNER ?? "gagan114662";
const repo = process.env.E2E_REPO_NAME ?? "acp-e2e-fixture";

const { db, sql } = makeDb();
await db.insert(orgs).values({ id: "o1", name: "Demo Org" }).onConflictDoNothing();
await db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "Demo" }).onConflictDoNothing();
await db.insert(members).values({ id: "m1", orgId: "o1", workspaceId: "w1", displayName: "You" }).onConflictDoNothing();
await db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: owner, githubName: repo, defaultBranch: "main", tokenEnvVar: "E2E_GITHUB_TOKEN" }).onConflictDoNothing();
await db.insert(channels).values({ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }).onConflictDoNothing();
await db.insert(threads).values({ id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1" }).onConflictDoNothing();
await db.insert(agents).values({ id: "a1", orgId: "o1", workspaceId: "w1", handle: "coder", displayName: "Coder", adapter: "fake", config: {} }).onConflictDoNothing();
await sql.end();
console.log("seeded");
