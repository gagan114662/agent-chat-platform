import { describe, it, expect } from "vitest";
import { stalledRuns, isAlive } from "./heartbeat.js";
import { compactContext, type Msg } from "./compaction.js";

describe("heartbeats (#116)", () => {
  const now = 100_000;
  const beats = [
    { id: "fresh", lastBeatMs: 99_000 },   // 1s ago
    { id: "stale", lastBeatMs: 50_000 },   // 50s ago
  ];
  it("flags only runs past the timeout", () => {
    expect(stalledRuns(beats, now, 10_000)).toEqual(["stale"]);
    expect(stalledRuns(beats, now, 60_000)).toEqual([]);
  });
  it("isAlive within the window, dead otherwise / when missing", () => {
    expect(isAlive(beats[0], now, 10_000)).toBe(true);
    expect(isAlive(beats[1], now, 10_000)).toBe(false);
    expect(isAlive(undefined, now, 10_000)).toBe(false);
  });
});

describe("context compaction (#116)", () => {
  const msgs: Msg[] = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `m${i}` }));
  it("keeps recent verbatim and folds older into one summary", () => {
    const r = compactContext(msgs, { keepRecent: 3 });
    expect(r.compactedCount).toBe(7);
    expect(r.kept.length).toBe(4); // 1 summary + 3 recent
    expect(r.kept[0].role).toBe("system");
    expect(r.kept.slice(1).map((m) => m.content)).toEqual(["m7", "m8", "m9"]);
  });
  it("is a no-op under the keepRecent threshold", () => {
    const r = compactContext(msgs.slice(0, 2), { keepRecent: 5 });
    expect(r.compactedCount).toBe(0);
    expect(r.kept.length).toBe(2);
  });
  it("uses an injected summarizer when provided", () => {
    const r = compactContext(msgs, { keepRecent: 2, summarize: (older) => `sum:${older.length}` });
    expect(r.summary).toBe("sum:8");
    expect(r.kept[0].content).toBe("sum:8");
  });
});
