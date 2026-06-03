import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";

class QuietWS { onmessage: unknown = null; onopen: unknown = null; constructor() {} close() {} send() {} }

// Route each fetch by URL: nav endpoints return seed data; messages return [].
function routedFetch(url: string) {
  if (url === "/channels") return [{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }];
  if (url === "/repos") return [];
  if (url === "/channels/c1/threads") return [{ id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1" }];
  if (url.startsWith("/threads/")) return [];
  return [];
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietWS as unknown as typeof WebSocket);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => routedFetch(url) })) as unknown as typeof fetch);
});

describe("App", () => {
  it("loads channels + threads and renders the active thread", async () => {
    render(<App />);
    expect(screen.getByText("Demo Workspace")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("# general")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Demo thread" })).toBeInTheDocument());
  });
});
