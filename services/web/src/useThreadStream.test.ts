import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useThreadStream } from "./useThreadStream.js";
import type { Message } from "./types.js";

function msg(id: string, body: string, kind: Message["kind"] = "chat"): Message {
  return { id, orgId: "o1", threadId: "t1", authorKind: "human", authorId: "m1", kind, body, metadata: {}, createdAt: new Date(0).toISOString() };
}

// Minimal fake WebSocket capturing the instance so the test can push frames.
class FakeWS {
  static last: FakeWS | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  url: string;
  closed = false;
  constructor(url: string) { this.url = url; FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send() {}
  close() { this.closed = true; }
  push(m: Message) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [msg("1", "history hello")] })) as unknown as typeof fetch);
});

describe("useThreadStream", () => {
  it("loads history then appends live messages, deduping by id", async () => {
    const { result } = renderHook(() => useThreadStream("t1"));
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["1"]));

    act(() => { FakeWS.last!.push(msg("2", "live world", "system")); });
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["1", "2"]));

    // duplicate id must not double-append
    act(() => { FakeWS.last!.push(msg("2", "live world", "system")); });
    expect(result.current.messages.map((m) => m.id)).toEqual(["1", "2"]);
  });
});
