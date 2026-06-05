import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

// Theme store: toggles `html.theme-light` (which overrides the dark @theme tokens
// in index.css) and persists the choice. Defaults to dark.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("acp-theme") as Theme) === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", theme === "light");
    try { localStorage.setItem("acp-theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
