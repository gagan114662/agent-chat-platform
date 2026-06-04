import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { makeAppInstallationClient } from "./github-app.js";

// A throwaway 2048-bit RSA PEM generated per run — NO real GitHub key, NO network
// call. We only assert construction behaviour (env-driven build vs. clear throw);
// the live token exchange needs the real App key + network and is out of scope.
const { privateKey: TEST_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("makeAppInstallationClient", () => {
  let prevId: string | undefined;
  let prevKey: string | undefined;

  beforeEach(() => {
    prevId = process.env.GITHUB_APP_ID;
    prevKey = process.env.GITHUB_APP_PRIVATE_KEY;
  });
  afterEach(() => {
    if (prevId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = prevId;
    if (prevKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY; else process.env.GITHUB_APP_PRIVATE_KEY = prevKey;
  });

  it("builds an App-authed Octokit from env without throwing (no network)", () => {
    process.env.GITHUB_APP_ID = "3965781";
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
    const client = makeAppInstallationClient(123);
    expect(client).toBeInstanceOf(Octokit);
  });

  it("throws a clear error when GITHUB_APP_ID is unset", () => {
    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
    expect(() => makeAppInstallationClient(123)).toThrow(/GITHUB_APP_ID is not set/);
  });

  it("throws a clear error when GITHUB_APP_PRIVATE_KEY is unset", () => {
    process.env.GITHUB_APP_ID = "3965781";
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(() => makeAppInstallationClient(123)).toThrow(/GITHUB_APP_PRIVATE_KEY is not set/);
  });

  it("throws when GITHUB_APP_ID is non-numeric", () => {
    process.env.GITHUB_APP_ID = "not-a-number";
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PEM;
    expect(() => makeAppInstallationClient(123)).toThrow(/must be numeric/);
  });
});
