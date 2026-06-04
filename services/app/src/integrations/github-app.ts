import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

// makeAppInstallationClient builds an Octokit authenticated AS A GITHUB APP
// INSTALLATION. It reads the App's credentials from the environment:
//   GITHUB_APP_ID          — the numeric App ID
//   GITHUB_APP_PRIVATE_KEY — the App's RSA private key (PEM contents)
// and the per-call installationId (an org/repo's install of the App).
//
// The returned Octokit mints short-lived installation access tokens on demand
// (via @octokit/auth-app), so it's a drop-in replacement for the PAT-based
// OctokitGitHubService once installation ids are mapped per repo. No token is
// requested here — only the first API call exchanges the App JWT for one.
//
// Throws a clear error if either env var is unset (fail fast at construction).
export function makeAppInstallationClient(installationId: number): Octokit {
  const appIdRaw = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appIdRaw) {
    throw new Error("GITHUB_APP_ID is not set — cannot build a GitHub App installation client");
  }
  if (!privateKey) {
    throw new Error("GITHUB_APP_PRIVATE_KEY is not set — cannot build a GitHub App installation client");
  }

  const appId = Number(appIdRaw);
  if (!Number.isFinite(appId)) {
    throw new Error(`GITHUB_APP_ID must be numeric, got "${appIdRaw}"`);
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}
