import { describe, it, expect } from "vitest";
import { governDispatch, maxMentionDepth } from "./bus-governance.js";

const base = {
  chain: [] as string[],
  toAgentId: "b",
  fromAuthorKind: "human" as const,
  fromAuthorId: "u1",
  depth: 0,
  alreadyDispatched: new Set<string>(),
};

describe("bus-governance #111", () => {
  it("allows a normal first dispatch", () => {
    expect(governDispatch(base).allow).toBe(true);
  });

  it("blocks past the max depth", () => {
    const v = governDispatch({ ...base, depth: 4, maxDepth: 4 });
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/max mention depth/);
  });

  it("blocks an agent self-trigger", () => {
    const v = governDispatch({ ...base, fromAuthorKind: "agent", fromAuthorId: "b", toAgentId: "b" });
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/self-trigger/);
  });

  it("dedupes within a single fan-out", () => {
    const v = governDispatch({ ...base, alreadyDispatched: new Set(["b"]) });
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/dedupe/);
  });

  it("detects a cycle (agent already in the chain)", () => {
    const v = governDispatch({ ...base, chain: ["a", "b", "c"], toAgentId: "b", fromAuthorKind: "agent", fromAuthorId: "c" });
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/cycle/);
  });

  it("maxMentionDepth honors override then env then default", () => {
    expect(maxMentionDepth(7)).toBe(7);
    const prev = process.env.ACP_MAX_MENTION_DEPTH;
    process.env.ACP_MAX_MENTION_DEPTH = "9";
    expect(maxMentionDepth()).toBe(9);
    delete process.env.ACP_MAX_MENTION_DEPTH;
    expect(maxMentionDepth()).toBe(4);
    if (prev !== undefined) process.env.ACP_MAX_MENTION_DEPTH = prev;
  });
});
