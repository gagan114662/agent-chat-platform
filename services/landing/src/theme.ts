// Brand tokens for the Convene marketing site. Mirrors the app's reload-style
// palette: lavender-gray background, near-black accents, white rounded surfaces,
// one blue highlight. Inter everywhere.
export const theme = {
  brand: "Convene",
  wordmark: "Convene",
  colors: {
    bg: "#f0f0f7",
    text: "#2b2b2b",
    accent: "#15151f", // near-black
    accentSoft: "#1f1f2b",
    blue: "#2563eb",
    blueSoft: "#3b82f6",
    surface: "#ffffff",
    hairline: "#e7e7f0",
    muted: "#8a8a99",
  },
  radius: {
    card: "0.875rem", // rounded-xl-ish
    pill: "9999px",
  },
} as const;

export type Theme = typeof theme;
