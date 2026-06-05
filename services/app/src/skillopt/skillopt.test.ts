import { describe, it, expect } from "vitest";
import { applyEdit, editKey } from "./edit.js";
import { acceptEdit } from "./validation.js";
import { RejectedBuffer } from "./rejected-buffer.js";
import { optimizeStep, type Rollout } from "./optimizer.js";
import { isHarnessAgnostic, transferSkill } from "./transfer.js";

const budget = { maxChars: 50 };

describe("#134 bounded atomic edits", () => {
  it("appends/inserts/replaces/deletes within budget", () => {
    expect(applyEdit("abc", { op: "append", text: "X" }, budget).doc).toBe("abcX");
    expect(applyEdit("abc", { op: "insert", at: 1, text: "Z" }, budget).doc).toBe("aZbc");
    expect(applyEdit("a foo b", { op: "replace", find: "foo", text: "bar" }, budget).doc).toBe("a bar b");
    expect(applyEdit("a foo b", { op: "delete", find: " foo" }, budget).doc).toBe("a b");
  });
  it("rejects over-budget edits", () => {
    const r = applyEdit("abc", { op: "append", text: "x".repeat(100) }, budget);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/budget/);
  });
  it("refuses to touch the protected core", () => {
    const doc = "intro\n<<CORE>>\nslow rules\n<</CORE>>\noutro";
    const core = { open: "<<CORE>>", close: "<</CORE>>" };
    const r = applyEdit(doc, { op: "replace", find: "slow rules", text: "hacked" }, budget, core);
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/protected core/);
    // editing outside the core is fine
    expect(applyEdit(doc, { op: "replace", find: "outro", text: "end" }, budget, core).ok).toBe(true);
  });
});

describe("#133 validation gate", () => {
  it("accepts only strict held-out improvement", () => {
    expect(acceptEdit(0.5, 0.7).accept).toBe(true);
    expect(acceptEdit(0.5, 0.5).accept).toBe(false);
    expect(acceptEdit(0.5, 0.4).accept).toBe(false);
  });
});

describe("#135 rejected buffer", () => {
  it("remembers rejected edits by key", () => {
    const b = new RejectedBuffer();
    const e = { op: "append" as const, text: "bad" };
    expect(b.has(e)).toBe(false);
    b.add(e, -0.2, "regressed");
    expect(b.has(e)).toBe(true);
    expect(b.size).toBe(1);
    expect(editKey(e)).toContain("append");
  });
});

describe("#132 closed-loop optimizer", () => {
  const rollouts: Rollout[] = [{ score: 0.4 }];
  it("accepts an edit that improves the held-out score", () => {
    const propose = () => ({ op: "append" as const, text: "\n- be concise" });
    const evaluate = (doc: string) => (doc.includes("be concise") ? 0.8 : 0.4);
    const rej = new RejectedBuffer();
    const r = optimizeStep("base skill", rollouts, propose, evaluate, budget, rej);
    expect(r.accepted).toBe(true);
    expect(r.doc).toContain("be concise");
    expect(rej.size).toBe(0);
  });
  it("rejects + buffers an edit that doesn't improve", () => {
    const propose = () => ({ op: "append" as const, text: "\n- noise" });
    const evaluate = () => 0.4; // never improves
    const rej = new RejectedBuffer();
    const r = optimizeStep("base skill", rollouts, propose, evaluate, budget, rej);
    expect(r.accepted).toBe(false);
    expect(r.doc).toBe("base skill"); // unchanged
    expect(rej.size).toBe(1); // remembered
  });
  it("skips an already-rejected edit", () => {
    const propose = () => ({ op: "append" as const, text: "\n- noise" });
    const evaluate = () => 0.4;
    const rej = new RejectedBuffer();
    rej.add({ op: "append", text: "\n- noise" }, -0.1, "prior");
    const r = optimizeStep("base skill", rollouts, propose, evaluate, budget, rej);
    expect(r.reason).toMatch(/already rejected/);
  });
});

describe("#136 harness-agnostic transfer", () => {
  it("detects + strips harness-specific lines for portable transfer", () => {
    const doc = "Always write tests.\nRun with claude-code --permission-mode acceptEdits\nKeep PRs small.";
    expect(isHarnessAgnostic(doc)).toBe(false);
    const portable = transferSkill(doc);
    expect(portable).toBe("Always write tests.\nKeep PRs small.");
    expect(isHarnessAgnostic(portable)).toBe(true);
    expect(transferSkill(portable)).toBe(portable); // idempotent
  });
});
