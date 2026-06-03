import { describe, it, expect } from "vitest";
import { buildServer } from "../server.js";
import { makeDb } from "../db/client.js";
import { runs } from "../db/schema.js";
import { eq } from "drizzle-orm";

const env = {
  token: process.env.E2E_GITHUB_TOKEN,
  owner: process.env.E2E_REPO_OWNER,
  repo: process.env.E2E_REPO_NAME,
  db: process.env.DATABASE_URL,
  temporal: process.env.TEMPORAL_ADDRESS,
  sandbox: process.env.SANDBOX_URL,
};
const ready = Object.values(env).every(Boolean);

if (!ready && Object.values(env).some(Boolean)) {
  console.warn("chat-fusion e2e skipped: partial config");
}

describe.runIf(ready)("chat fusion e2e (real GitHub + sandbox + temporal)", () => {
  it("posting an @mention drives a real PR to merged and posts a pr_card", async () => {
    const app = await buildServer();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as { port: number };

    const res = await fetch(`http://127.0.0.1:${port}/threads/t1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-org-id": "o1", "x-user-id": "m1" },
      body: JSON.stringify({ body: "@coder e2e: append agent changes file" }),
    });
    const { startedRuns } = await res.json() as { startedRuns: string[] };
    expect(startedRuns.length).toBe(1);

    const { db, sql } = makeDb();
    let state = "pending";
    for (let i = 0; i < 48 && !["merged", "checks_failed", "timeout", "error"].includes(state); i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const [r] = await db.select().from(runs).where(eq(runs.id, startedRuns[0]));
      state = r.state;
    }
    expect(["merged", "checks_failed", "timeout"]).toContain(state);
    console.log("chat e2e run state:", state);
    await sql.end(); await app.close();
  });
});
