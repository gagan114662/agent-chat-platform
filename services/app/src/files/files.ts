import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { files } from "../db/schema.js";

export type ArtifactKind = "code" | "document" | "markdown" | "image" | "other";

// inferArtifactKind classifies a file from its contentType and/or name extension.
// Order: explicit image content-type → markdown → code → document → other. The
// extension is a fallback when the content-type is generic (octet-stream/text).
export function inferArtifactKind(contentType: string, name = ""): ArtifactKind {
  const ct = (contentType || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";

  if (ct.startsWith("image/")) return "image";
  if (ct === "text/markdown" || ext === ".md" || ext === ".markdown") return "markdown";

  const codeExts = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
    ".java", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".php", ".swift", ".kt",
    ".sh", ".bash", ".sql", ".json", ".yaml", ".yml", ".toml", ".css", ".html",
  ]);
  if (codeExts.has(ext)) return "code";

  const docExts = new Set([".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".csv", ".xls", ".xlsx"]);
  if (ct === "application/pdf" || ct.startsWith("text/") || docExts.has(ext)) return "document";

  return "other";
}

export interface CreateFileInput {
  orgId: string;
  name: string;
  contentType?: string;
  size?: number;
  byKind: string;
  byId: string;
}

// createFile records the metadata row (uploaded=false) and returns it. The bytes
// are NOT stored yet — they arrive via a signed PUT to /files/:id/content which
// flips `uploaded` true. storageKey is org-scoped (`<orgId>/<id>`).
export async function createFile(db: DB, input: CreateFileInput) {
  const id = randomUUID();
  const contentType = input.contentType || "application/octet-stream";
  const row = {
    id,
    orgId: input.orgId,
    name: input.name,
    contentType,
    artifactKind: inferArtifactKind(contentType, input.name),
    size: Math.max(0, Math.floor(input.size ?? 0)),
    storageKey: `${input.orgId}/${id}`,
    uploaded: false,
    uploadedByKind: input.byKind,
    uploadedById: input.byId,
  };
  const [inserted] = await db.insert(files).values(row).returning();
  return inserted ?? row;
}

// getFile fetches an org-scoped file row (a foreign org id → undefined → caller 404s).
export async function getFile(db: DB, orgId: string, fileId: string) {
  const [f] = await db.select().from(files).where(and(eq(files.id, fileId), eq(files.orgId, orgId)));
  return f;
}

// markUploaded flips `uploaded` true and records the stored size. Org-scoped so a
// cross-org call is a no-op. Returns the updated row (undefined if not found).
export async function markUploaded(db: DB, orgId: string, fileId: string, size: number) {
  const [updated] = await db.update(files)
    .set({ uploaded: true, size: Math.max(0, Math.floor(size)) })
    .where(and(eq(files.id, fileId), eq(files.orgId, orgId)))
    .returning();
  return updated;
}

// --- HMAC-signed, time-limited URLs (the presigned-URL pattern, no cloud dep) ---

function signSecret(): string {
  // A stable app secret. ACP_FILE_SIGN_SECRET in prod; falls back to the session
  // secret or a constant so dev/test work without extra config.
  return process.env.ACP_FILE_SIGN_SECRET || process.env.ACP_SESSION_SECRET || "acp-dev-file-sign-secret";
}

export type FileOp = "put" | "get";

// signFileUrl mints an opaque token binding (op, fileId, exp). The token is
// `<exp>.<hmac>` where the HMAC covers `op:fileId:exp` — tampering with any field
// breaks the MAC. ttlSec bounds validity; `now` is injectable for tests.
export function signFileUrl(fileId: string, op: FileOp, ttlSec = 600, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + Math.floor(ttlSec);
  const mac = createHmac("sha256", signSecret()).update(`${op}:${fileId}:${exp}`).digest("hex");
  return `${exp}.${mac}`;
}

// verifyFileSig validates a token for (fileId, op): correct HMAC (timing-safe) and
// not expired. Any malformed/tampered/expired token → false.
export function verifyFileSig(fileId: string, op: FileOp, token: string, now = Date.now()): boolean {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  if (exp * 1000 < now) return false; // expired

  const expected = createHmac("sha256", signSecret()).update(`${op}:${fileId}:${exp}`).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
