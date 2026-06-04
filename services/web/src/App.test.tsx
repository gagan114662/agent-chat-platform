import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";

class QuietWS { onmessage: unknown = null; onopen: unknown = null; constructor() {} close() {} send() {} }

function makeFetch(meStatus: number) {
  return vi.fn(async (url: string) => {
    if (url === "/auth/me") return { status: meStatus, ok: meStatus === 200, json: async () => ({ orgId: "o1", userId: "m1" }) };
    if (url === "/auth/members") return { ok: true, json: async () => [{ id: "m1", displayName: "You", orgId: "o1" }] };
    if (url === "/channels") return { ok: true, json: async () => [{ id: "c1", orgId: "o1", workspaceId: "w1", name: "general" }] };
    if (url === "/channels/c1/threads") return { ok: true, json: async () => [{ id: "t1", orgId: "o1", channelId: "c1", title: "Demo thread", repoId: "r1", kind: "channel" }] };
    return { ok: true, json: async () => [] };
  }) as unknown as typeof fetch;
}

beforeEach(() => { localStorage.clear(); vi.stubGlobal("WebSocket", QuietWS as unknown as typeof WebSocket); });

describe("App auth gate", () => {
  it("shows the workspace when authenticated", async () => {
    localStorage.setItem("acp_token", "tok");
    vi.stubGlobal("fetch", makeFetch(200));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Demo Workspace")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Demo thread" })).toBeInTheDocument());
  });

  it("shows the login screen when unauthenticated", async () => {
    vi.stubGlobal("fetch", makeFetch(401));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/sign in \(dev\)/i)).toBeInTheDocument());
  });
});
