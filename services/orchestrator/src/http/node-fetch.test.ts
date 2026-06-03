import { describe, it, expect } from "vitest";
import { nodeFetch } from "./node-fetch.js";

describe("nodeFetch", () => {
  it("rejects immediately when given an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      nodeFetch("https://api.github.com/", { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("throws on an unsupported body type", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeFetch("https://api.github.com/", { method: "POST", body: { not: "supported" } as any })
    ).rejects.toThrow(/unsupported body type/);
  });
});
