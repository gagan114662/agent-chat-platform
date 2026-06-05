import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { recordLink, chainForTask } from "./chain-store.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("delegation chain store (#130)", () => {
  it("records hand-offs and traces to the accountable human", async () => {
    await recordLink(h.db, { orgId: "o1", taskId: "t1", byKind: "human", byId: "alice", toKind: "agent", toId: "coder" });
    await recordLink(h.db, { orgId: "o1", taskId: "t1", byKind: "agent", byId: "coder", toKind: "agent", toId: "cursor" });
    await recordLink(h.db, { orgId: "o2", taskId: "t1", byKind: "human", byId: "bob", toKind: "agent", toId: "x" }); // other org
    const { chain, accountableHuman } = await chainForTask(h.db, "o1", "t1");
    expect(chain.length).toBe(2);
    expect(accountableHuman).toBe("alice");
  });
});
