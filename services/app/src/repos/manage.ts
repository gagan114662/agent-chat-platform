import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { repos, goals } from "../db/schema.js";
import { createGoal } from "../autonomy/goals.js";

// #139 connect arbitrary repos (incl. the platform's own) + ingest a repo's open
// GitHub issues as goals, so the loop can build itself and other businesses
// instead of being hard-wired to one demo repo.

// The token env var the run path reads (process.env[tokenEnvVar]) to auth GitHub.
// Defaults to the platform's configured token, which already has access to the
// owner's repos (incl. agent-chat-platform).
export const DEFAULT_TOKEN_ENV = process.env.ACP_DEFAULT_REPO_TOKEN_ENV ?? "E2E_GITHUB_TOKEN";

export interface ConnectRepoInput {
  orgId: string; workspaceId: string; githubOwner: string; githubName: string;
  defaultBranch?: string; tokenEnvVar?: string; production?: boolean;
}
export class RepoError extends Error {}

// connectRepo: register an existing GitHub repo with the workspace so goals/threads
// can target it. Validates the token env is present (else the run path can't auth).
// production repos are plan-first (merges go through the human gate, #125/#20).
export async function connectRepo(db: DB, input: ConnectRepoInput) {
  const owner = input.githubOwner.trim(), name = input.githubName.trim();
  if (!owner || !name) throw new RepoError("githubOwner and githubName are required");
  const tokenEnvVar = input.tokenEnvVar?.trim() || DEFAULT_TOKEN_ENV;
  if (!process.env[tokenEnvVar]) {
    throw new RepoError(`no GitHub token in env var "${tokenEnvVar}" — set it on the server (the run path reads process.env[${tokenEnvVar}])`);
  }
  // Idempotent: re-connecting the same (owner,name) returns the existing row.
  const existing = await db.select().from(repos)
    .where(and(eq(repos.orgId, input.orgId), eq(repos.githubOwner, owner), eq(repos.githubName, name)));
  if (existing[0]) return existing[0];
  const production = input.production ?? true; // default: treat a newly-connected repo as a real product repo
  const [row] = await db.insert(repos).values({
    id: randomUUID(), orgId: input.orgId, workspaceId: input.workspaceId,
    githubOwner: owner, githubName: name, defaultBranch: input.defaultBranch?.trim() || "main",
    tokenEnvVar, production,
    planMode: production, // #139: production repos plan-first → human approves the merge
    autonomy: "autopilot-merge",
  }).returning();
  return row;
}

// An open issue from a repo (the subset we ingest). PRs are excluded by the caller.
export interface RepoIssue { number: number; title: string; body?: string | null }
export type IssueFetcher = (repo: { githubOwner: string; githubName: string; tokenEnvVar: string; githubApiUrl?: string | null }) => Promise<RepoIssue[]>;

// githubIssueFetcher: list a repo's OPEN issues via the GitHub REST API (no extra
// dep — plain fetch + the repo's token). Excludes pull requests (the issues API
// returns PRs too; they carry a `pull_request` field).
export const githubIssueFetcher: IssueFetcher = async (repo) => {
  const token = process.env[repo.tokenEnvVar];
  if (!token) throw new RepoError(`no GitHub token in env var "${repo.tokenEnvVar}"`);
  const base = (repo.githubApiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const url = `${base}/repos/${repo.githubOwner}/${repo.githubName}/issues?state=open&per_page=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "acp" } });
  if (!res.ok) throw new RepoError(`GitHub issues fetch failed: ${res.status}`);
  const arr = (await res.json()) as Array<{ number: number; title: string; body?: string | null; pull_request?: unknown }>;
  return arr.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: i.body }));
};

// ingestIssues: turn a connected repo's open issues into goals (one per issue),
// titled "#<n> <title>" so re-ingest is idempotent (skips issues already a goal).
// Each goal's criteria defaults to the issue body. Returns the created goal ids.
export async function ingestIssues(
  db: DB, args: { orgId: string; repoId: string; byId: string; fetch?: IssueFetcher },
): Promise<{ created: string[]; skipped: number }> {
  const [repo] = await db.select().from(repos).where(and(eq(repos.id, args.repoId), eq(repos.orgId, args.orgId)));
  if (!repo) throw new RepoError("repo not found");
  const issues = await (args.fetch ?? githubIssueFetcher)(repo);
  const existing = new Set((await db.select({ title: goals.title }).from(goals).where(eq(goals.orgId, args.orgId))).map((g) => g.title));
  const created: string[] = [];
  let skipped = 0;
  for (const issue of issues) {
    const title = `#${issue.number} ${issue.title}`;
    if (existing.has(title)) { skipped++; continue; }
    const g = await createGoal(db, { orgId: args.orgId, title, criteria: issue.body ?? "", byKind: "human", byId: args.byId });
    created.push(g.id);
  }
  return { created, skipped };
}
