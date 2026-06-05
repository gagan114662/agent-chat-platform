import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { testDb, closeDb } from "../db/test-harness.js";
import { saveSkillVersion, latestSkill, listSkillVersions } from "./skills.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });
beforeEach(async () => { await h.reset(); });

describe("agent skill documents (#131)", () => {
  it("each save is a new immutable version; latest wins; org/agent scoped", async () => {
    await saveSkillVersion(h.db, "o1", "a1", "v1 content");
    await saveSkillVersion(h.db, "o1", "a1", "v2 content");
    const l = await latestSkill(h.db, "o1", "a1");
    expect(l?.version).toBe(2);
    expect(l?.content).toBe("v2 content");
    expect((await listSkillVersions(h.db, "o1", "a1")).length).toBe(2);
    expect(await latestSkill(h.db, "o1", "other")).toBeNull();
  });
});
