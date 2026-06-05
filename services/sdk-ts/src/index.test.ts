import { describe, it, expect } from "vitest";
import { AcpClient, AcpError, type FetchLike } from "./index.js";

// A fake fetch that records every call and returns a canned ok/json response.
function fakeFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const text = response.body !== undefined ? JSON.stringify(response.body) : "";
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => (text ? JSON.parse(text) : undefined),
      text: async () => text,
    };
  };
  return { f, calls };
}

function client(f: FetchLike, baseUrl = "https://api.test") {
  return new AcpClient({ baseUrl, token: "acp_secret", fetch: f });
}

describe("AcpClient (#86)", () => {
  it("sends a bearer token on a GET and returns parsed JSON", async () => {
    const { f, calls } = fakeFetch({ body: [{ id: "c1" }] });
    const out = await client(f).listChannels();
    expect(out).toEqual([{ id: "c1" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe("https://api.test/channels");
    expect(calls[0].headers?.authorization).toBe("Bearer acp_secret");
  });

  it("includeArchived adds the query param", async () => {
    const { f, calls } = fakeFetch({ body: [] });
    await client(f).listChannels({ includeArchived: true });
    expect(calls[0].url).toBe("https://api.test/channels?includeArchived=1");
  });

  it("postMessage POSTs a JSON body with content-type and url-encodes the thread id", async () => {
    const { f, calls } = fakeFetch({ status: 201, body: { message: { id: "m1" }, startedRuns: ["r1"] } });
    const out = await client(f).postMessage("th/1", "hello @iris");
    expect(out).toEqual({ message: { id: "m1" }, startedRuns: ["r1"] });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.test/threads/th%2F1/messages");
    expect(calls[0].headers?.["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body!)).toEqual({ body: "hello @iris" });
  });

  it("createTasksBulk hits /tasks/bulk with threadId + items", async () => {
    const { f, calls } = fakeFetch({ status: 201, body: { ids: ["t1", "t2"] } });
    const out = await client(f).createTasksBulk("th1", [{ title: "A" }, { title: "B", priority: "high" }]);
    expect(out).toEqual({ ids: ["t1", "t2"] });
    expect(calls[0].url).toBe("https://api.test/tasks/bulk");
    expect(JSON.parse(calls[0].body!)).toEqual({
      threadId: "th1",
      items: [{ title: "A" }, { title: "B", priority: "high" }],
    });
  });

  it("memoryRecall builds the q + limit query", async () => {
    const { f, calls } = fakeFetch({ body: [] });
    await client(f).memoryRecall("deploy policy", 3);
    expect(calls[0].url).toBe("https://api.test/memory/recall?q=deploy+policy&limit=3");
  });

  it("approveRun POSTs with no body", async () => {
    const { f, calls } = fakeFetch({ body: { id: "r1", state: "merged" } });
    await client(f).approveRun("r1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api.test/runs/r1/approve");
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers?.["content-type"]).toBeUndefined();
  });

  it("importLinear POSTs the threadId", async () => {
    const { f, calls } = fakeFetch({ body: { imported: 2, ids: ["t1", "t2"] } });
    const out = await client(f).importLinear("th1");
    expect(out).toEqual({ imported: 2, ids: ["t1", "t2"] });
    expect(calls[0].url).toBe("https://api.test/integrations/linear/import");
    expect(JSON.parse(calls[0].body!)).toEqual({ threadId: "th1" });
  });

  it("getBilling GETs /billing", async () => {
    const { f, calls } = fakeFetch({ body: { plan: { id: "pro" } } });
    await client(f).getBilling();
    expect(calls[0].url).toBe("https://api.test/billing");
    expect(calls[0].method).toBe("GET");
  });

  it("trims a trailing slash on baseUrl", async () => {
    const { f, calls } = fakeFetch({ body: [] });
    await client(f, "https://api.test/").listChannels();
    expect(calls[0].url).toBe("https://api.test/channels");
  });

  it("throws AcpError carrying status + server error message on a non-2xx", async () => {
    const { f } = fakeFetch({ ok: false, status: 404, body: { error: "thread not found" } });
    await expect(client(f).listMessages("nope")).rejects.toMatchObject({
      name: "AcpError",
      status: 404,
      message: "thread not found",
    });
    await expect(client(f).listMessages("nope")).rejects.toBeInstanceOf(AcpError);
  });
});
