import type { ChecksStatus, PullRequest } from "../types.js";
import type { ChangedFile } from "../policy/risk.js";

export interface OpenPrInput {
  owner: string;
  repo: string;
  head: string; // branch
  base: string;
  title: string;
  body: string;
}

export interface ReviewComment {
  id: number;
  body: string;
  user: string;
  path?: string;
  line?: number;
}

export interface FileContent {
  content: string;
  encoding: "utf8" | "base64";
  size: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  htmlUrl: string;
}

export interface GitHubService {
  openPr(input: OpenPrInput): Promise<PullRequest>;
  // Find-or-create support (#70): returns the first open PR whose head is `head`
  // (the branch), or null if none. Lets a retried activity reuse an existing PR
  // instead of creating a duplicate.
  findPrForBranch(owner: string, repo: string, head: string): Promise<{ number: number; url: string } | null>;
  getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus>;
  merge(owner: string, repo: string, prNumber: number): Promise<void>;
  getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
  // Lists a repo's issues (open by default). Pull requests are filtered out — the
  // GitHub REST issues endpoint returns PRs too (they carry a `pull_request` key).
  listIssues(owner: string, repo: string, opts?: { first?: number }): Promise<GitHubIssue[]>;
  // Reads a single file's content at a ref. Text files are decoded to utf8; binary
  // files (images/pdf/etc by extension) are returned as raw base64. Throws if the
  // file exceeds the size cap or the path is not a file.
  getFileContent(owner: string, repo: string, ref: string, path: string): Promise<FileContent>;
  // Summarizes the failing check/status contexts for a ref into a short string,
  // used as feedback notes for the agent on a fix-on-red attempt.
  getCheckFailureContext(owner: string, repo: string, ref: string): Promise<string>;
  // Lists the PR review comments (the request-changes inflow), pulled on demand into the thread.
  listReviewComments(owner: string, repo: string, prNumber: number): Promise<ReviewComment[]>;
  // Edits a PR's title/body and/or switches its base branch. Only the provided fields are sent.
  updatePr(
    owner: string,
    repo: string,
    prNumber: number,
    patch: { title?: string; body?: string; base?: string }
  ): Promise<void>;
}
