import { describe, it, expect } from "vitest";
import { parseLogs, errorIncidents } from "./logs.js";

describe("parseLogs", () => {
  it("parses NDJSON: extracts level/message, skips malformed lines", () => {
    const body = [
      `{"level":"error","message":"db down"}`,
      `WARN disk almost full`,
      `{not valid json`,
      ``,
      `   `,
    ].join("\n");
    const records = parseLogs(body, "application/x-ndjson");
    // malformed JSON line is skipped; blank/whitespace skipped; WARN text kept.
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ level: "error", message: "db down" });
    expect(records[1].level).toBe("warn");
    expect(records[1].message).toContain("disk almost full");
  });

  it("parses a JSON array body", () => {
    const body = JSON.stringify([
      { severity: "fatal", msg: "kernel panic" },
      { lvl: "info", text: "ok" },
    ]);
    const records = parseLogs(body, "application/json");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ level: "fatal", message: "kernel panic" });
    expect(records[1]).toMatchObject({ level: "info", message: "ok" });
  });

  it("plain text: 'ERROR boom' infers level error; plain line defaults to info", () => {
    const body = ["ERROR boom", "just a normal line"].join("\n");
    const records = parseLogs(body, "text/plain");
    expect(records).toHaveLength(2);
    expect(records[0].level).toBe("error");
    expect(records[0].message).toContain("boom");
    expect(records[1].level).toBe("info");
    expect(records[1].message).toBe("just a normal line");
  });

  it("returns [] for empty / whitespace-only input", () => {
    expect(parseLogs("", "text/plain")).toEqual([]);
    expect(parseLogs("\n\n  \n")).toEqual([]);
  });
});

describe("errorIncidents", () => {
  it("groups error/fatal records into idempotent incidents; ignores non-errors", () => {
    const records = [
      { level: "error", message: "db down: connection refused", raw: {} },
      { level: "warn", message: "slow query", raw: {} },
      { level: "fatal", message: "out of memory killed pid 42", raw: {} },
      { level: "info", message: "started", raw: {} },
    ];
    const incs = errorIncidents(records);
    expect(incs.length).toBeGreaterThanOrEqual(1);
    for (const i of incs) {
      expect(i.key.startsWith("log-err:")).toBe(true);
      expect(["high", "medium"]).toContain(i.severity);
      expect(i.title.length).toBeGreaterThan(0);
    }
    // deterministic: same input → same keys (idempotent dedup keys).
    const again = errorIncidents(records);
    expect(again.map((i) => i.key).sort()).toEqual(incs.map((i) => i.key).sort());
  });

  it("dedups error records that share a message prefix into one incident", () => {
    const records = [
      { level: "error", message: "db down: refused at 1.1.1.1", raw: {} },
      { level: "error", message: "db down: refused at 2.2.2.2", raw: {} },
    ];
    const incs = errorIncidents(records);
    expect(incs).toHaveLength(1);
  });

  it("returns [] when there are no error/fatal records", () => {
    expect(errorIncidents([{ level: "info", message: "ok", raw: {} }])).toEqual([]);
  });
});
