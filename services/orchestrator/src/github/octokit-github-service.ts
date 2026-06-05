import { Octokit } from "@octokit/rest";
import type { GitHubService, OpenPrInput, ReviewComment, FileContent, GitHubIssue, CheckContext } from "./github-service.js";
import type { ChecksStatus, PullRequest } from "../types.js";
import type { ChangedFile } from "../policy/risk.js";
import { nodeFetch } from "../http/node-fetch.js";

// 1 MiB cap — guards against pulling huge blobs into the thread/preview.
const MAX_FILE_BYTES = 1024 * 1024;

// File extensions we keep as raw base64 (binary) rather than decoding to utf8.
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp",
  "pdf", "zip", "gz", "tar", "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "mov", "wav", "ogg", "webm",
]);

function isBinaryPath(path: string): boolean {
  const ext = path.includes(".") ? path.split(".").pop()!.toLowerCase() : "";
  return BINARY_EXTS.has(ext);
}

export class OctokitGitHubService implements GitHubService {
  private readonly octokit: Octokit;

  // baseUrl optionally points the client at a GitHub Enterprise host's API root
  // (e.g. "https://ghe.example.com/api/v3"). Undefined => api.github.com as today.
  constructor(token: string, baseUrl?: string) {
    this.octokit = new Octokit({
      auth: token,
      ...(baseUrl ? { baseUrl } : {}),
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

  async findPrForBranch(
    owner: string,
    repo: string,
    head: string,
  ): Promise<{ number: number; url: string } | null> {
    const res = await this.octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${head}`,
      state: "open",
    });
    const first = res.data[0];
    return first ? { number: first.number, url: first.html_url } : null;
  }

  async getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus> {
    // Two distinct GitHub signals must both be honored: the legacy commit
    // statuses API (CircleCI/Travis-style contexts) AND the Checks API
    // (GitHub Actions report here, never as legacy statuses). Reading only the
    // combined status makes an Actions-only repo look "pending" forever, so the
    // merge gate polls until timeout (#103). Combine both into one verdict.
    const [statusRes, checkRes] = await Promise.all([
      this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref }),
      this.octokit.checks.listForRef({ owner, repo, ref, per_page: 100 }),
    ]);
    const verdicts: ChecksStatus[] = [];
    for (const s of statusRes.data.statuses ?? []) {
      if (s.state === "failure" || s.state === "error") verdicts.push("failure");
      else if (s.state === "success") verdicts.push("success");
      else verdicts.push("pending");
    }
    for (const c of checkRes.data.check_runs ?? []) {
      if (c.status !== "completed") { verdicts.push("pending"); continue; }
      const ok = c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped";
      verdicts.push(ok ? "success" : "failure");
    }
    if (verdicts.includes("failure")) return "failure";
    // No signals yet (CI not registered) stays pending so we never merge ahead
    // of checks; the gate's own timeout bounds the wait.
    if (verdicts.length === 0 || verdicts.includes("pending")) return "pending";
    return "success";
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

  async getCheckFailureContext(owner: string, repo: string, ref: string): Promise<string> {
    const res = await this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
    const failing = res.data.statuses
      .filter((s) => s.state === "failure" || s.state === "error")
      .map((s) => s.context);
    if (failing.length === 0) {
      return `CI failed for ${ref} (no failing status contexts reported)`;
    }
    return `CI failed: ${failing.join(", ")}`;
  }

  async getCheckContexts(owner: string, repo: string, ref: string): Promise<CheckContext[]> {
    const res = await this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
    return res.data.statuses.map((s) => ({
      context: s.context,
      state: s.state,
      description: s.description ?? undefined,
      targetUrl: s.target_url ?? undefined,
    }));
  }

  async getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    const res = await this.octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    return res.data.map((f) => ({
      filename: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
      patch: f.patch,
    }));
  }

  async listIssues(owner: string, repo: string, opts?: { first?: number }): Promise<GitHubIssue[]> {
    const res = await this.octokit.issues.listForRepo({
      owner, repo, state: "open", per_page: opts?.first ?? 50,
    });
    // The issues endpoint also returns PRs; they carry a `pull_request` key. Drop them.
    return res.data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? undefined,
        state: issue.state,
        htmlUrl: issue.html_url,
      }));
  }

  async getFileContent(owner: string, repo: string, ref: string, path: string): Promise<FileContent> {
    const res = await this.octokit.repos.getContent({ owner, repo, path, ref });
    const data = res.data;
    // A directory listing comes back as an array; we only serve single files.
    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`path is not a file: ${path}`);
    }
    if (data.size > MAX_FILE_BYTES) {
      throw new Error(`file too large: ${path} (${data.size} bytes)`);
    }
    // GitHub returns base64 (with newlines) in `content` for files.
    const b64 = (data.content ?? "").replace(/\n/g, "");
    if (isBinaryPath(path)) {
      return { content: b64, encoding: "base64", size: data.size };
    }
    const content = Buffer.from(b64, "base64").toString("utf8");
    return { content, encoding: "utf8", size: data.size };
  }

  async updatePr(
    owner: string,
    repo: string,
    prNumber: number,
    patch: { title?: string; body?: string; base?: string }
  ): Promise<void> {
    await this.octokit.pulls.update({ owner, repo, pull_number: prNumber, ...patch });
  }

  async listReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]> {
    const res = await this.octokit.pulls.listReviewComments({ owner, repo, pull_number: prNumber });
    return res.data.map((c) => ({
      id: c.id,
      body: c.body,
      user: c.user?.login ?? "?",
      path: c.path,
      line: c.line ?? undefined,
    }));
  }
}
