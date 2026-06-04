import { Octokit } from "@octokit/rest";
import type { GitHubService, OpenPrInput } from "./github-service.js";
import type { ChecksStatus, PullRequest } from "../types.js";
import type { ChangedFile } from "../policy/risk.js";
import { nodeFetch } from "../http/node-fetch.js";

export class OctokitGitHubService implements GitHubService {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      request: { fetch: nodeFetch as typeof globalThis.fetch },
    });
  }

  async openPr(input: OpenPrInput): Promise<PullRequest> {
    const res = await this.octokit.pulls.create({
      owner: input.owner,
      repo: input.repo,
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { number: res.data.number, url: res.data.html_url };
  }

  async getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus> {
    const res = await this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
    const state = res.data.state; // "success" | "pending" | "failure" | "error"
    if (state === "success") return "success";
    if (state === "failure" || state === "error") return "failure";
    return "pending";
  }

  async merge(owner: string, repo: string, prNumber: number): Promise<void> {
    const res = await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber });
    // GitHub can return 200 with `{ merged: false }` (e.g. not mergeable).
    if (res.data.merged !== true) {
      const reason = res.data.message ? `: ${res.data.message}` : "";
      throw new Error(
        `Failed to merge PR #${prNumber} for ${owner}/${repo}${reason}`
      );
    }
  }

  async getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const res = await this.octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    return res.data.map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
    }));
  }
}
