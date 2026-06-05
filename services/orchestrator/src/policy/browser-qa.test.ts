import { describe, it, expect, vi } from "vitest";
import { browserQaRunner, type BrowserDriver } from "./browser-qa.js";

// A configurable fake BrowserDriver so tests never touch real Chromium.
function fakeDriver(opts: {
  text?: string;
  errors?: string[];
  gotoThrows?: boolean;
  visited?: { url?: string };
  screenshots?: string[];
}): () => Promise<BrowserDriver> {
  return async () => ({
    async goto(url: string) {
      if (opts.visited) opts.visited.url = url;
      if (opts.gotoThrows) throw new Error("net::ERR_CONNECTION_REFUSED");
    },
    consoleErrors() {
      return opts.errors ?? [];
    },
    async textContent() {
      return opts.text ?? "";
    },
    async screenshot(path: string) {
      opts.screenshots?.push(path);
    },
    async close() {},
  });
}

const input = { prNumber: 7, branch: "feature-x" };

describe("browserQaRunner", () => {
  it("clean page (content, no console errors) → passed + screenshot captured", async () => {
    const shots: string[] = [];
    const runner = browserQaRunner({
      baseUrl: "https://preview.example.com",
      driverFactory: fakeDriver({ text: "Welcome to the app", screenshots: shots }),
    });
    const r = await runner.run(input);
    expect(r.passed).toBe(true);
    expect(shots.length).toBe(1);
  });

  it("console error → failed and error appears in summary", async () => {
    const runner = browserQaRunner({
      baseUrl: "https://preview.example.com",
      driverFactory: fakeDriver({ text: "content", errors: ["TypeError: x is not a function"] }),
    });
    const r = await runner.run(input);
    expect(r.passed).toBe(false);
    expect(r.summary).toContain("TypeError: x is not a function");
  });

  it("empty/blank page → failed (no content)", async () => {
    const runner = browserQaRunner({
      baseUrl: "https://preview.example.com",
      driverFactory: fakeDriver({ text: "   " }),
    });
    const r = await runner.run(input);
    expect(r.passed).toBe(false);
    expect(r.summary.toLowerCase()).toContain("no content");
  });

  it("goto that throws → failed gracefully", async () => {
    const runner = browserQaRunner({
      baseUrl: "https://preview.example.com",
      driverFactory: fakeDriver({ gotoThrows: true }),
    });
    const r = await runner.run(input);
    expect(r.passed).toBe(false);
    expect(r.summary).toContain("ERR_CONNECTION_REFUSED");
  });

  it("visits the right URL (PR-preview pattern)", async () => {
    const visited: { url?: string } = {};
    const runner = browserQaRunner({
      baseUrl: "https://app.example.com",
      previewUrlPattern: "https://pr-{pr}.preview.example.com",
      driverFactory: fakeDriver({ text: "ok", visited }),
    });
    await runner.run(input);
    expect(visited.url).toBe("https://pr-7.preview.example.com");
  });

  it("defaults to baseUrl when no preview pattern given", async () => {
    const visited: { url?: string } = {};
    const runner = browserQaRunner({
      baseUrl: "https://app.example.com",
      driverFactory: fakeDriver({ text: "ok", visited }),
    });
    await runner.run(input);
    expect(visited.url).toBe("https://app.example.com");
  });

  it("closes the driver even when goto throws", async () => {
    const close = vi.fn(async () => {});
    const runner = browserQaRunner({
      baseUrl: "https://app.example.com",
      driverFactory: async () => ({
        async goto() {
          throw new Error("boom");
        },
        consoleErrors() {
          return [];
        },
        async textContent() {
          return "";
        },
        async screenshot() {},
        close,
      }),
    });
    await runner.run(input);
    expect(close).toHaveBeenCalledOnce();
  });
});
