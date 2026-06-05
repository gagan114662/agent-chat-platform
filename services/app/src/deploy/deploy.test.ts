import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs, workspaces, repos, goals } from "../db/schema.js";
import { parseDeployUrl, runDeploy, deployRepo, type Exec } from "./deploy.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

const okExec = (url: string): Exec => async () => ({ stdout: `building...\nACP_DEPLOY_URL=${url}\ndone`, exitCode: 0 });
const failExec: Exec = async () => ({ stdout: "boom", exitCode: 1 });
const healthy = async () => true;
const unhealthy = async () => false;

describe("parseDeployUrl", () => {
  it("extracts the ACP_DEPLOY_URL line", () => {
    expect(parseDeployUrl("x\nACP_DEPLOY_URL=https://foo.app\ny")).toBe("https://foo.app");
    expect(parseDeployUrl("no url here")).toBeNull();
  });
});

describe("runDeploy", () => {
  it("succeeds when the command emits a URL and it's healthy", async () => {
    const r = await runDeploy("deploy.sh", null, okExec("https://foo.app"), healthy);
    expect(r).toMatchObject({ ok: true, url: "https://foo.app" });
  });
  it("fails (no config) when there's no deploy command", async () => {
    expect((await runDeploy("", null, okExec("x"), healthy)).ok).toBe(false);
  });
  it("rolls back (keeps prev URL) when the new deploy is unhealthy", async () => {
    const r = await runDeploy("deploy.sh", "https://old.app", okExec("https://new.app"), unhealthy);
    expect(r.ok).toBe(false); expect(r.rolledBack).toBe(true);
  });
  it("fails when the command exits non-zero", async () => {
    expect((await runDeploy("deploy.sh", null, failExec, healthy)).ok).toBe(false);
  });
});

describe("deployRepo persistence", () => {
  beforeEach(async () => {
    await h.reset();
    await h.db.insert(orgs).values({ id: "o1", name: "O" });
    await h.db.insert(workspaces).values({ id: "w1", orgId: "o1", name: "W" });
    await h.db.insert(repos).values({ id: "r1", orgId: "o1", workspaceId: "w1", githubOwner: "x", githubName: "y", defaultBranch: "main", tokenEnvVar: "T", deployCommand: "deploy.sh" });
    await h.db.insert(goals).values({ id: "g1", orgId: "o1", title: "ship", criteria: "Service live at a public URL", state: "active", createdByKind: "human", createdById: "m1" });
  });

  it("records liveUrl on the repo and the goal on success", async () => {
    const r = await deployRepo(h.db, { orgId: "o1", repoId: "r1", goalId: "g1", exec: okExec("https://shipped.app"), health: healthy });
    expect(r.ok).toBe(true);
    expect((await h.db.select().from(repos).where(eq(repos.id, "r1")))[0].liveUrl).toBe("https://shipped.app");
    expect((await h.db.select().from(goals).where(eq(goals.id, "g1")))[0].liveUrl).toBe("https://shipped.app");
  });

  it("does not overwrite liveUrl when the deploy fails", async () => {
    await h.db.update(repos).set({ liveUrl: "https://prev.app" }).where(eq(repos.id, "r1"));
    await deployRepo(h.db, { orgId: "o1", repoId: "r1", exec: okExec("https://broken.app"), health: unhealthy });
    expect((await h.db.select().from(repos).where(eq(repos.id, "r1")))[0].liveUrl).toBe("https://prev.app");
  });
});
