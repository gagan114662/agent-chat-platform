import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDb, closeDb } from "../db/test-harness.js";
import { orgs } from "../db/schema.js";
import {
  createFile, getFile, markUploaded,
  inferArtifactKind, signFileUrl, verifyFileSig,
} from "./files.js";
import { LocalStorage, safeJoin } from "./storage.js";

const h = testDb();
afterAll(async () => { await closeDb(h.sql); });

beforeEach(async () => {
  await h.reset();
  await h.db.insert(orgs).values({ id: "o1", name: "O" });
  await h.db.insert(orgs).values({ id: "o2", name: "O B" });
});

describe("inferArtifactKind", () => {
  it("maps .md → markdown", () => {
    expect(inferArtifactKind("application/octet-stream", "notes.md")).toBe("markdown");
    expect(inferArtifactKind("text/markdown", "x")).toBe("markdown");
  });
  it("maps image/png → image", () => {
    expect(inferArtifactKind("image/png", "logo")).toBe("image");
  });
  it("maps .ts → code", () => {
    expect(inferArtifactKind("application/octet-stream", "server.ts")).toBe("code");
  });
  it("maps pdf/text → document, unknown → other", () => {
    expect(inferArtifactKind("application/pdf", "x.pdf")).toBe("document");
    expect(inferArtifactKind("application/zip", "a.bin")).toBe("other");
  });
});

describe("createFile", () => {
  it("inserts uploaded=false, org-scoped storageKey, inferred kind", async () => {
    const f = await createFile(h.db, {
      orgId: "o1", name: "server.ts", contentType: "application/octet-stream",
      size: 0, byKind: "human", byId: "m1",
    });
    expect(f.artifactKind).toBe("code");
    expect(f.uploaded).toBe(false);
    expect(f.storageKey).toBe(`o1/${f.id}`);
    expect(f.orgId).toBe("o1");
  });

  it("getFile is org-scoped (cross-org → undefined)", async () => {
    const f = await createFile(h.db, { orgId: "o1", name: "a.md", byKind: "human", byId: "m1" });
    expect(await getFile(h.db, "o1", f.id)).toBeTruthy();
    expect(await getFile(h.db, "o2", f.id)).toBeUndefined();
  });

  it("markUploaded flips uploaded + size (org-scoped)", async () => {
    const f = await createFile(h.db, { orgId: "o1", name: "a.png", contentType: "image/png", byKind: "human", byId: "m1" });
    // cross-org no-op
    expect(await markUploaded(h.db, "o2", f.id, 10)).toBeUndefined();
    const up = await markUploaded(h.db, "o1", f.id, 123);
    expect(up?.uploaded).toBe(true);
    expect(up?.size).toBe(123);
  });
});

describe("signFileUrl / verifyFileSig", () => {
  it("round-trips true for the matching op + fileId", () => {
    const tok = signFileUrl("file1", "put", 600);
    expect(verifyFileSig("file1", "put", tok)).toBe(true);
  });
  it("rejects a tampered token / wrong op / wrong file", () => {
    const tok = signFileUrl("file1", "put", 600);
    expect(verifyFileSig("file1", "get", tok)).toBe(false);   // wrong op
    expect(verifyFileSig("file2", "put", tok)).toBe(false);   // wrong file
    expect(verifyFileSig("file1", "put", tok + "00")).toBe(false); // tampered mac
    expect(verifyFileSig("file1", "put", "garbage")).toBe(false);
  });
  it("rejects an expired token", () => {
    const now = Date.now();
    const tok = signFileUrl("file1", "get", 600, now);
    // 601s later → expired
    expect(verifyFileSig("file1", "get", tok, now + 601_000)).toBe(false);
    expect(verifyFileSig("file1", "get", tok, now + 599_000)).toBe(true);
  });
});

describe("LocalStorage", () => {
  it("put/get round-trips a buffer", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "acp-test-"));
    const s = new LocalStorage(dir);
    const data = Buffer.from("hello bytes");
    await s.put("o1/abc", data);
    const got = await s.get("o1/abc");
    expect(got.equals(data)).toBe(true);
  });

  it("rejects path traversal / absolute keys", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "acp-test-"));
    const s = new LocalStorage(dir);
    expect(() => safeJoin(dir, "../escape")).toThrow();
    expect(() => safeJoin(dir, "/etc/passwd")).toThrow();
    expect(() => safeJoin(dir, "a/../../b")).toThrow();
    await expect(s.put("../escape", Buffer.from("x"))).rejects.toThrow();
    // a legitimate nested key is fine
    expect(() => safeJoin(dir, "o1/sub/file")).not.toThrow();
  });
});
