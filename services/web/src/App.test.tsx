import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";

class QuietWS { onmessage: unknown = null; onopen: unknown = null; constructor() {} close() {} send() {} }

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietWS as unknown as typeof WebSocket);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});

describe("App", () => {
  it("renders the shell and empty-state", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Demo thread" })).toBeInTheDocument();
    expect(screen.getByText("Demo Workspace")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/No messages yet/i)).toBeInTheDocument());
  });
});
