type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// returns true if the key is allowed (and records the hit), false if over the limit.
export function allow(key: string, limit = 5, windowMs = 60_000, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (b.count >= limit) return false;
  b.count++; return true;
}

export function _reset() { buckets.clear(); } // test hook
