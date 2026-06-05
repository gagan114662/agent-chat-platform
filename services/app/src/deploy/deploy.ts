import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { repos, goals } from "../db/schema.js";

// #140 deploy step. The fusion loop ends at "merged PR"; this ships the merged
// product to a public URL so a business actually has something customers can reach
// (and so a "live at a public URL" criterion can be satisfied, #138).
//
// A repo's admin-configured `deployCommand` (trusted config, run in the sandbox)
// is expected to print a line `ACP_DEPLOY_URL=<url>`. We run it, parse the URL,
// health-check it, and on success record it on the repo (and the goal). A failed
// health check does NOT overwrite the previous liveUrl (rollback-safe).

export type Exec = (cmd: string) => Promise<{ stdout: string; exitCode: number }>;
export type HealthCheck = (url: string) => Promise<boolean>;

const URL_RE = /ACP_DEPLOY_URL=(\S+)/;
export function parseDeployUrl(stdout: string): string | null {
  const m = stdout.match(URL_RE);
  return m ? m[1] : null;
}

// httpHealthCheck: a deploy is live only if its URL answers 2xx/3xx.
export const httpHealthCheck: HealthCheck = async (url) => {
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual" });
    return res.status >= 200 && res.status < 400;
  } catch { return false; }
};

export interface DeployResult {
  ok: boolean;
  url?: string;
  reason: string;
  rolledBack?: boolean; // true when the new deploy failed health and we kept the old URL
}

// runDeploy: pure orchestration over injected exec + healthCheck. No DB. Returns
// the new live URL on success, or a reason + rollback flag on failure.
export async function runDeploy(
  deployCommand: string | null | undefined,
  prevUrl: string | null | undefined,
  exec: Exec, health: HealthCheck = httpHealthCheck,
): Promise<DeployResult> {
  if (!deployCommand?.trim()) return { ok: false, reason: "no deployCommand configured for this repo" };
  const out = await exec(deployCommand);
  if (out.exitCode !== 0) return { ok: false, reason: `deploy command exited ${out.exitCode}`, rolledBack: !!prevUrl };
  const url = parseDeployUrl(out.stdout);
  if (!url) return { ok: false, reason: "deploy produced no ACP_DEPLOY_URL=<url> line", rolledBack: !!prevUrl };
  if (!(await health(url))) return { ok: false, url, reason: "health check failed — kept previous URL", rolledBack: !!prevUrl };
  return { ok: true, url, reason: "deployed + healthy" };
}

// deployRepo: run a connected repo's deploy and persist the result. On success
// records repos.liveUrl (and goals.liveUrl for any goal targeting threads on this
// repo when goalId is given). Org-scoped.
export async function deployRepo(
  db: DB, args: { orgId: string; repoId: string; goalId?: string; exec: Exec; health?: HealthCheck },
): Promise<DeployResult> {
  const [repo] = await db.select().from(repos).where(and(eq(repos.id, args.repoId), eq(repos.orgId, args.orgId)));
  if (!repo) return { ok: false, reason: "repo not found" };
  const res = await runDeploy(repo.deployCommand, repo.liveUrl, args.exec, args.health);
  if (res.ok && res.url) {
    await db.update(repos).set({ liveUrl: res.url }).where(and(eq(repos.id, args.repoId), eq(repos.orgId, args.orgId)));
    if (args.goalId) {
      await db.update(goals).set({ liveUrl: res.url }).where(and(eq(goals.id, args.goalId), eq(goals.orgId, args.orgId)));
    }
  }
  return res;
}
