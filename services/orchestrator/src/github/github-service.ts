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

export interface GitHubService {
  openPr(input: OpenPrInput): Promise<PullRequest>;
  getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus>;
  merge(owner: string, repo: string, prNumber: number): Promise<void>;
  getChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]>;
  // Summarizes the failing check/status contexts for a ref into a short string,
  // used as feedback notes for the agent on a fix-on-red attempt.
  getCheckFailureContext(owner: string, repo: string, ref: string): Promise<string>;
}
