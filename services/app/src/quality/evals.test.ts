import { describe, it, expect } from "vitest";
import { scanDiff, criteriaCoverage, evaluate } from "./evals.js";
import type { ChangedFile } from "@acp/orchestrator/policy/risk.js";

const file = (filename: string, added: string[]): ChangedFile =>
  ({ filename, additions: added.length, deletions: 0, status: "modified", patch: ["+++ b/" + filename, ...added.map((l) => "+" + l)].join("\n") } as ChangedFile);

describe("quality evals (#151)", () => {
  it("blocks placeholders + leaked secrets in production files", () => {
    const fails = scanDiff([
      file("index.html", ['<a href="STRIPE_PAYMENT_LINK_HERE">Buy</a>', "<a href='https://pay.example.com'>x</a>"]),
      file("config.ts", ["const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';"]),
    ]);
    expect(fails.some((f) => f.check === "placeholder" && f.severity === "block")).toBe(true);
    expect(fails.some((f) => f.check === "secret-scan" && f.severity === "block")).toBe(true);
  });

  it("ignores placeholders in docs/tests, and clean prod code passes", () => {
    expect(scanDiff([file("NOTES.md", ["pay.example.com TODO replace before launch"])])).toEqual([]);
    expect(scanDiff([file("src/app.ts", ["export const price = 4900;"])])).toEqual([]);
  });

  it("blocks a dead purchase CTA (placeholder Buy link), but not a real one (#156)", () => {
    expect(scanDiff([file("index.html", ['<a href="#">Buy now</a>'])]).some((f) => f.check === "dead-cta")).toBe(true);
    expect(scanDiff([file("index.html", ['<a href="javascript:void(0)">Checkout</a>'])]).some((f) => f.check === "dead-cta")).toBe(true);
    // a real, wired CTA and an unrelated anchor are fine
    expect(scanDiff([file("index.html", ['<a href="/checkout?quote=q_123">Buy now</a>'])])).toEqual([]);
    expect(scanDiff([file("index.html", ['<a href="#pricing">See pricing</a>'])])).toEqual([]);
  });

  it("warns when a deliverable does not cover an acceptance criterion", () => {
    const dl = "Added a Stripe checkout button and a pricing section.";
    const fails = criteriaCoverage(dl, "Stripe checkout works\nDeploy to a public URL");
    // "Stripe checkout" is covered; "Deploy to a public URL" is not
    expect(fails.some((f) => /public url/i.test(f.reason))).toBe(true);
    expect(fails.every((f) => f.severity === "warn")).toBe(true);
  });

  it("evaluate aggregates: blocks fail, warns lower the score but still pass", () => {
    const blocked = evaluate({ files: [file("index.html", ["TODO finish this"])] });
    expect(blocked.pass).toBe(false);
    const warned = evaluate({ deliverable: "did half", criteria: "do the whole thing properly here" });
    expect(warned.pass).toBe(true);
    expect(warned.score).toBeLessThan(1);
  });
});
