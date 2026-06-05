import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { files } from "../db/schema.js";
import { actor } from "./actor.js";
import { createFile, getFile, markUploaded, signFileUrl, verifyFileSig } from "../files/files.js";
import { defaultStorage, type StorageBackend } from "../files/storage.js";

export interface FileStorageDeps {
  db: DB;
  storage?: StorageBackend;
}

// 25 MiB upload cap (#80). Over → 413 on the content PUT, 400 on the declared size.
const MAX_SIZE = 25 * 1024 * 1024;

// registerFileStorageRoutes — #80 file & artifact storage.
//
//   POST  /files                 (auth)  → create row + mint a signed upload URL
//   PUT   /files/:id/content?sig (SIG)   → store the bytes (valid put-sig only), markUploaded
//   GET   /files/:id             (auth)  → metadata + a signed download URL
//   GET   /files/:id/download?sig (SIG)  → stream the bytes (valid get-sig only)
//
// The `?sig=` content/download routes bypass the user-session preHandler (added to
// the bypass list in auth-routes) and ENFORCE the HMAC signature instead — mirrors
// the /ingest/* machine-auth bypass pattern. POST and GET-metadata stay under auth.
export function registerFileStorageRoutes(app: FastifyInstance, d: FileStorageDeps) {
  // Register inside an ENCAPSULATED child plugin so the binary content-type parser
  // (below) is local to these routes and can't collide with the ingest routes'
  // string parser on the shared instance, nor leak `*`/octet-stream buffer parsing
  // to the rest of the app. The root auth preHandler still applies to children.
  app.register(async (instance) => {
    fileStorageRoutes(instance, d);
  });
}

function fileStorageRoutes(app: FastifyInstance, d: FileStorageDeps) {
  const storage = d.storage ?? defaultStorage();

  // Raw-body parser for the content PUT — arbitrary bytes read as a Buffer, capped.
  // A `*` catch-all is safe here because it's scoped to this encapsulated child
  // (it does not affect JSON parsing on the root app or sibling route plugins).
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_SIZE }, (_req, body, done) => done(null, body));

  // POST /files — create the metadata row + signed upload URL. Under normal auth.
  app.post<{ Body: { name?: string; contentType?: string; size?: number } }>(
    "/files",
    async (req, reply) => {
      const a = actor(req);
      const { name, contentType, size } = req.body ?? {};
      if (!name || typeof name !== "string") return reply.code(400).send({ error: "name required" });
      const declared = typeof size === "number" ? Math.floor(size) : 0;
      if (declared < 0) return reply.code(400).send({ error: "invalid size" });
      if (declared > MAX_SIZE) return reply.code(400).send({ error: "file too large", maxSize: MAX_SIZE });

      const file = await createFile(d.db, {
        orgId: a.orgId, name, contentType, size: declared,
        byKind: "human", byId: a.userId,
      });
      const sig = signFileUrl(file.id, "put");
      return reply.code(201).send({ file, uploadUrl: `/files/${file.id}/content?sig=${sig}` });
    },
  );

  // PUT /files/:id/content?sig= — store the bytes. Auth IS the signature (put-op).
  app.put<{ Params: { id: string }; Querystring: { sig?: string } }>(
    "/files/:id/content",
    { bodyLimit: MAX_SIZE },
    async (req, reply) => {
      const { id } = req.params;
      const sig = req.query.sig;
      if (!sig || !verifyFileSig(id, "put", sig)) {
        return reply.code(401).send({ error: "invalid signature" });
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
      if (body.length > MAX_SIZE) {
        return reply.code(413).send({ error: "file too large", maxSize: MAX_SIZE });
      }
      // Resolve the file from the sig-bound id alone (no session org here). The
      // storageKey is org-prefixed at create time, so this stays org-scoped.
      const [file] = await d.db.select().from(files).where(eq(files.id, id));
      if (!file) return reply.code(404).send({ error: "not found" });

      await storage.put(file.storageKey, body);
      const updated = await markUploaded(d.db, file.orgId, file.id, body.length);
      return reply.code(200).send({ file: updated, stored: body.length });
    },
  );

  // GET /files/:id — metadata + a signed download URL. Under normal auth, org-scoped.
  app.get<{ Params: { id: string } }>(
    "/files/:id",
    async (req, reply) => {
      const a = actor(req);
      const file = await getFile(d.db, a.orgId, req.params.id);
      if (!file) return reply.code(404).send({ error: "not found" });
      const sig = signFileUrl(file.id, "get");
      return reply.send({ file, downloadUrl: `/files/${file.id}/download?sig=${sig}` });
    },
  );

  // GET /files/:id/download?sig= — stream the bytes. Auth IS the signature (get-op).
  app.get<{ Params: { id: string }; Querystring: { sig?: string } }>(
    "/files/:id/download",
    async (req, reply) => {
      const { id } = req.params;
      const sig = req.query.sig;
      if (!sig || !verifyFileSig(id, "get", sig)) {
        return reply.code(401).send({ error: "invalid signature" });
      }
      const [file] = await d.db.select().from(files).where(eq(files.id, id));
      if (!file) return reply.code(404).send({ error: "not found" });
      let bytes: Buffer;
      try {
        bytes = await storage.get(file.storageKey);
      } catch {
        return reply.code(404).send({ error: "not found" });
      }
      reply.header("content-type", file.contentType || "application/octet-stream");
      reply.header("content-disposition", `attachment; filename="${file.name.replace(/"/g, "")}"`);
      return reply.send(bytes);
    },
  );
}
