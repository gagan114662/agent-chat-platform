// Deterministic per-identity avatar colors (reload.chat-style): each member/agent
// gets a stable, distinct color from their name/id instead of one bland accent.
// Inline hex (not Tailwind classes) so the color is dynamic and never purged.
const COLORS = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#eab308", // yellow
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// Up-to-2-char initials from a name/handle (strip a leading @, skip separators).
export function initials(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  const parts = clean.split(/[\s_\-.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}
