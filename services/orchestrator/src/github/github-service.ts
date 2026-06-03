import type { ChecksStatus, PullRequest } from "../types.js";

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
}
