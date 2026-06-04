import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { buildAgentIntent } from "./activities.js";
import { createNode } from "../memory/memory.js";
import { orgs } from "../db/schema.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O2" });
});

describe("buildAgentIntent (#26 recall wiring)", () => {
  it("appends a recalled-context preamble when matching org memory exists; first line stays the task", async () => {
    await createNode(h.db, { orgId: "o1", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    await createNode(h.db, { orgId: "o1", kind: "fact", label: "Auth uses scrypt" });

    const intent = "add realtime notify to the auth flow";
    const out = await buildAgentIntent(h.db, "o1", intent);

    expect(out.split("\n")[0]).toBe(intent); // first line unchanged → clean PR title
    expect(out).toContain("## Relevant prior context");
    expect(out).toContain("Use Postgres LISTEN/NOTIFY for realtime");
    expect(out).toContain("Auth uses scrypt");
  });

  it("returns the intent unchanged when there is no matching memory", async () => {
    const intent = "add realtime notify to the auth flow";
    expect(await buildAgentIntent(h.db, "o1", intent)).toBe(intent);
  });

  it("is org-scoped: another org's memory does not leak into the preamble", async () => {
    await createNode(h.db, { orgId: "o2", kind: "decision", label: "Use Postgres LISTEN/NOTIFY for realtime" });
    const intent = "add realtime notify to the auth flow";
    // org o1 has no memory of its own → unchanged
    expect(await buildAgentIntent(h.db, "o1", intent)).toBe(intent);
  });
});
