import { describe, it, expect, afterEach } from "vitest";
import { needsUiQa, passThroughQa, makeQaRunner } from "./qa.js";
import type { ChangedFile } from "./risk.js";

const f = (filename: string): ChangedFile => ({ filename, additions: 1, deletions: 0, status: "modified" });

describe("qa gate", () => {
  it("needsUiQa true when UI files change", () => {
    expect(needsUiQa([f("src/App.tsx")])).toBe(true);
    expect(needsUiQa([f("src/styles.css")])).toBe(true);
    expect(needsUiQa([f("src/server.ts")])).toBe(false);
  });
  it("passThroughQa returns passed", async () => {
    const r = await passThroughQa.run({ prNumber: 1, branch: "b" });
    expect(r.passed).toBe(true);
  });
});

describe("makeQaRunner", () => {
  afterEach(() => {
    delete process.env.QA_BASE_URL;
    delete process.env.QA_PREVIEW_URL_PATTERN;
  });
  it("falls back to passThroughQa when QA_BASE_URL is unset", () => {
    delete process.env.QA_BASE_URL;
    expect(makeQaRunner()).toBe(passThroughQa);
  });
  it("returns a real (non-pass-through) browser runner when QA_BASE_URL is set", () => {
    process.env.QA_BASE_URL = "https://preview.example.com";
    expect(makeQaRunner()).not.toBe(passThroughQa);
  });
});
