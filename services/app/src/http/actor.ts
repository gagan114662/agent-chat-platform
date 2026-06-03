// Dev-auth stub: headers pick the acting principal. Real auth is Phase 2.2.
export function actor(req: { headers: Record<string, unknown> }) {
  return {
    orgId: (req.headers["x-org-id"] as string) ?? "o1",
    userId: (req.headers["x-user-id"] as string) ?? "m1",
  };
}
