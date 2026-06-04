// Dev-header auth fallback (x-org-id/x-user-id) is OFF by default (fail-closed).
// Set ACP_ALLOW_DEV_HEADERS=1 ONLY in local/dev/test to enable the header stub.
export function devHeadersAllowed(): boolean {
  return process.env.ACP_ALLOW_DEV_HEADERS === "1";
}
