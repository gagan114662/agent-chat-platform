/**
 * A minimal, general-purpose `fetch` implementation built on Node's
 * `node:http` / `node:https` modules.
 *
 * WHY THIS EXISTS:
 * Octokit v21 uses the global undici `fetch` by default. undici's `fetch`
 * bypasses Node's http/https transport, so `nock` — which works by patching
 * those core modules — cannot intercept Octokit requests in tests. By passing
 * this http/https-based shim to Octokit via `request.fetch`, requests flow
 * through the patchable transport and nock can mock them. In production it
 * behaves as an ordinary fetch.
 *
 * It is intentionally minimal (a walking-skeleton helper) but aims to be a
 * correct general-purpose shim for the subset of fetch Octokit relies on:
 * methods, headers (object / Headers / tuple array), string + Uint8Array
 * bodies, response status/headers/body, response url, and AbortSignal.
 */
import * as https from "node:https";
import * as http from "node:http";

/**
 * Convert any of the accepted `HeadersInit` shapes (plain object, tuple array,
 * or a `Headers` instance) into a plain `Record<string, string>` suitable for
 * `http.request` options.
 */
function toHeaderRecord(init?: HeadersInit): Record<string, string> {
  const headers = new Headers(init);
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function nodeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = typeof url === "string" ? new URL(url) : url;

    const signal = init?.signal;
    if (signal?.aborted) {
      reject(makeAbortError());
      return;
    }

    const transport = u.protocol === "https:" ? https : http;
    const options: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: toHeaderRecord(init?.headers),
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const status = res.statusCode ?? 200;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) {
            const vals = Array.isArray(v) ? v : [v];
            for (const val of vals) headers.append(k, val);
          }
        }
        const response = new Response(body, {
          status,
          statusText: res.statusMessage ?? "",
          headers,
        });
        // `Response.url` is read-only, so define it explicitly.
        Object.defineProperty(response, "url", { value: u.toString() });
        resolve(response);
      });
      res.on("error", reject);
    });

    req.on("error", reject);

    // Honor AbortSignal: tear down the socket and reject if aborted mid-flight.
    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(makeAbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    if (init?.body !== undefined && init.body !== null) {
      if (typeof init.body === "string") {
        req.write(init.body);
      } else if (init.body instanceof Uint8Array) {
        req.write(init.body);
      } else {
        req.destroy();
        reject(new TypeError(`nodeFetch: unsupported body type: ${typeof init.body}`));
        return;
      }
    }

    req.end();
  });
}

/** Build an AbortError-style error matching the DOM AbortError convention. */
function makeAbortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}
