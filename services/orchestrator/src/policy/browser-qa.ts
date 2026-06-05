import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QaResult, QaRunner } from "./qa.js";

// A minimal headless-browser seam. The Playwright impl lives behind this so the
// runner can be exercised with a fake driver in unit tests (no live Chromium).
export interface BrowserDriver {
  goto(url: string): Promise<void>;
  consoleErrors(): string[];
  textContent(): Promise<string>;
  screenshot(path: string): Promise<void>;
  close(): Promise<void>;
}

// Real driver backed by playwright-core's chromium. Launches headless, opens a
// page that collects `console` error events, and exposes the BrowserDriver seam.
// Not exercised in unit tests — requires a real browser binary at runtime
// (`npx playwright install chromium`).
export async function playwrightDriver(): Promise<BrowserDriver> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "networkidle" });
    },
    consoleErrors() {
      return errors;
    },
    async textContent() {
      return (await page.textContent("body")) ?? "";
    },
    async screenshot(path) {
      await page.screenshot({ path, fullPage: true });
    },
    async close() {
      await browser.close();
    },
  };
}

export interface BrowserQaOpts {
  baseUrl: string;
  // Optional per-PR preview URL template; `{pr}` and `{branch}` are substituted.
  previewUrlPattern?: string;
  driverFactory?: () => Promise<BrowserDriver>;
  screenshotDir?: string;
}

function targetUrl(opts: BrowserQaOpts, input: { prNumber: number; branch: string }): string {
  if (opts.previewUrlPattern) {
    return opts.previewUrlPattern
      .replace(/\{pr\}/g, String(input.prNumber))
      .replace(/\{branch\}/g, input.branch);
  }
  return opts.baseUrl;
}

// Drives a browser QA pass over a PR's preview deploy: navigate, collect console
// errors, read page content, capture a screenshot. Passes only if the page
// loaded with non-empty content and no console errors. Fails gracefully.
export function browserQaRunner(opts: BrowserQaOpts): QaRunner {
  const factory = opts.driverFactory ?? playwrightDriver;
  const screenshotDir = opts.screenshotDir ?? tmpdir();
  return {
    async run(input): Promise<QaResult> {
      const url = targetUrl(opts, input);
      const failures: string[] = [];
      let driver: BrowserDriver | undefined;
      try {
        driver = await factory();
        await driver.goto(url);
        const text = (await driver.textContent()).trim();
        if (text.length === 0) failures.push("page rendered no content");
        const errors = driver.consoleErrors();
        for (const e of errors) failures.push(`console error: ${e}`);
        const shot = join(screenshotDir, `qa-pr-${input.prNumber}.png`);
        await driver.screenshot(shot);
        if (failures.length === 0) {
          return { passed: true, summary: `browser QA passed for ${url} (screenshot: ${shot})` };
        }
        return { passed: false, summary: `browser QA failed for ${url}: ${failures.join("; ")}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { passed: false, summary: `browser QA failed for ${url}: ${msg}` };
      } finally {
        if (driver) await driver.close().catch(() => {});
      }
    },
  };
}
