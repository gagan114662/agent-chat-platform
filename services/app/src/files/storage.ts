import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// StorageBackend abstracts the bytes store behind a file row. LocalStorage (disk)
// is the MVP impl; an S3/R2 backend is a drop-in (implement put/get against a
// bucket — the same interface, no route/model changes). Keys are sanitized by the
// backend so an attacker-controlled storageKey can never escape the storage dir.
export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

// Rejects path traversal / absolute keys and resolves the key strictly UNDER dir.
// Throws on `..` segments, leading `/`, or any resolved path that escapes dir.
export function safeJoin(dir: string, key: string): string {
  if (!key || key.includes("\0")) throw new Error("invalid storage key");
  if (path.isAbsolute(key)) throw new Error("invalid storage key: absolute");
  // Reject any traversal segment outright (belt) before resolving (suspenders).
  if (key.split(/[\\/]/).some((seg) => seg === "..")) {
    throw new Error("invalid storage key: traversal");
  }
  const root = path.resolve(dir);
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("invalid storage key: escapes storage dir");
  }
  return full;
}

export class LocalStorage implements StorageBackend {
  readonly dir: string;
  constructor(dir = process.env.ACP_STORAGE_DIR ?? mkdtempSync(path.join(tmpdir(), "acp-storage-"))) {
    this.dir = path.resolve(dir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = safeJoin(this.dir, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    const full = safeJoin(this.dir, key);
    if (!existsSync(full)) throw new Error(`storage key not found: ${key}`);
    return readFile(full);
  }
}

// defaultStorage returns the process-wide local backend. Swap this for an S3/R2
// backend (same StorageBackend interface) to move bytes off local disk — no
// changes to files.ts or the routes are required.
let _default: StorageBackend | undefined;
export function defaultStorage(): StorageBackend {
  if (!_default) _default = new LocalStorage();
  return _default;
}
