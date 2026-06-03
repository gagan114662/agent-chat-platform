const MENTION_RE = /(?:^|\s)@([a-z0-9_-]+)/gi;

export function parseMentions(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const handle = m[1].toLowerCase();
    if (!seen.has(handle)) { seen.add(handle); out.push(handle); }
  }
  return out;
}
