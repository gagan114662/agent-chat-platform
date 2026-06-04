// TS mirror of the Go sandbox redactCreds (defense-in-depth on the consumer
// side): strips URL userinfo and bare credentials so secrets never appear in
// orchestrator-thrown error messages, logs, or responses.
const URL_CREDS = /([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)[^/@\s]+@/g;
const BARE = [
  /x-access-token:[^@\s/]+/gi,
  /gh[pousr]_[0-9A-Za-z]+/g,
  /github_pat_[0-9A-Za-z_]+/g,
  /(?:Bearer|token)\s+[^\s,;]+/gi,
  /AKIA[0-9A-Z]{16}/g,
];

export function redactCreds(s: string): string {
  let out = s.replace(URL_CREDS, "$1[redacted]@");
  for (const re of BARE) out = out.replace(re, "[redacted]");
  return out;
}
