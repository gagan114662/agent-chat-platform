import { describe, it, expect } from "vitest";
import { openapiSpec } from "./openapi.js";

describe("openapiSpec (#86)", () => {
  it("declares OpenAPI 3 + info.title", () => {
    expect(openapiSpec.openapi).toMatch(/^3\./);
    expect(openapiSpec.info.title).toBe("agent-chat-platform API");
    expect(openapiSpec.info.version).toBeTruthy();
  });

  it("defines a bearerAuth HTTP bearer security scheme noting session + acp_ keys", () => {
    const scheme = openapiSpec.components.securitySchemes.bearerAuth;
    expect(scheme.type).toBe("http");
    expect(scheme.scheme).toBe("bearer");
    expect(scheme.description).toMatch(/acp_/);
    // applied globally
    expect(openapiSpec.security).toEqual([{ bearerAuth: [] }]);
  });

  it("covers at least 8 paths, each with a method that has responses", () => {
    const paths = Object.entries(openapiSpec.paths);
    expect(paths.length).toBeGreaterThanOrEqual(8);
    for (const [path, item] of paths) {
      const methods = Object.entries(item).filter(([k]) =>
        ["get", "post", "patch", "put", "delete"].includes(k),
      );
      expect(methods.length, `${path} has at least one method`).toBeGreaterThanOrEqual(1);
      for (const [method, op] of methods) {
        expect((op as { responses?: unknown }).responses, `${method} ${path} has responses`).toBeTruthy();
      }
    }
  });

  it("documents the core route families against real routes", () => {
    const keys = Object.keys(openapiSpec.paths);
    expect(keys).toEqual(
      expect.arrayContaining([
        "/auth/login",
        "/channels",
        "/threads/{id}/messages",
        "/tasks/bulk",
        "/tasks/{id}",
        "/runs/{id}/diff",
        "/memory",
        "/memory/recall",
        "/integrations/linear/import",
        "/billing",
      ]),
    );
  });

  it("marks /auth/login as public (no security) but secures /billing", () => {
    expect(openapiSpec.paths["/auth/login"].post.security).toEqual([]);
    // /billing inherits the global security (no per-op override)
    expect((openapiSpec.paths["/billing"].get as { security?: unknown }).security).toBeUndefined();
  });
});
