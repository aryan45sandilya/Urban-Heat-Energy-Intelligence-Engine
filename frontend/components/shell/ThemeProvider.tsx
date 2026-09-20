"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
  cycle: () => {},
});

const STORAGE_KEY = "uhei-theme";
const CHANGE_EVENT = "uhei-theme-change";
const MEDIA = "(prefers-color-scheme: dark)";

/* The stored preference and the OS setting are both external state, so they are
   read through `useSyncExternalStore` rather than mirrored into component state
   inside an effect. The snapshot is a string so React's identity check works
   without allocating a fresh object on every read. */

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MEDIA);
  query.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    query.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSnapshot(): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* private browsing or blocked site data — fall through to the default */
  }
  const theme = stored === "light" || stored === "dark" ? stored : "system";
  const systemDark = window.matchMedia(MEDIA).matches;
  return `${theme}|${systemDark ? 1 : 0}`;
}

// The server cannot know either value; it renders the light default and the
// client corrects on hydration. `suppressHydrationWarning` on <html> covers it.
const SERVER_SNAPSHOT = "system|0";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => SERVER_SNAPSHOT);
  const [storedTheme, systemFlag] = snapshot.split("|");

  const theme = storedTheme as Theme;
  const resolved: "light" | "dark" =
    theme === "system" ? (systemFlag === "1" ? "dark" : "light") : theme;

  // Writing an attribute onto <html> is a DOM side-effect, not component state.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-fatal: the choice simply will not persist */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const cycle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, cycle }),
    [theme, resolved, setTheme, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
