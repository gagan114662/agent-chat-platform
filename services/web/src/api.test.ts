import { describe, it, expect, vi, beforeEach } from "vitest";
import { listChannels, listThreads, createThread, listRepos } from "./api.js";
import { createChannel, searchMessages } from "./api.js";

beforeEach(() => vi.restoreAllMocks());

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

describe("nav api", () => {
  it("listChannels parses the array", async () => {
    vi.stubGlobal("fetch", mockFetch([{ id: "c1", name: "general" }]));
    expect((await listChannels()).map((c) => c.name)).toEqual(["general"]);
  });
  it("listThreads hits the channel path", async () => {
    const f = mockFetch([{ id: "t1" }]);
    vi.stubGlobal("fetch", f);
    await listThreads("c1");
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/channels/c1/threads");
  });
  it("createThread posts title + repoId and returns the thread", async () => {
    const f = mockFetch({ id: "tNew", title: "fix", repoId: "r1" }, true, 201);
    vi.stubGlobal("fetch", f);
    const t = await createThread("c1", { title: "fix", repoId: "r1" });
    expect(t.id).toBe("tNew");
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ title: "fix", repoId: "r1" });
  });
  it("listRepos parses the array", async () => {
    vi.stubGlobal("fetch", mockFetch([{ id: "r1", githubName: "r" }]));
    expect((await listRepos()).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("channel + search api", () => {
  it("createChannel posts the name", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: "cN", name: "random" }) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    const c = await createChannel("random");
    expect(c.id).toBe("cN");
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ name: "random" });
  });
  it("searchMessages encodes the query", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    await searchMessages("login bug");
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/search?q=login%20bug");
  });
});
