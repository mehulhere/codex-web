import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const THEME_CHANGED_EVENT = "codex-mobile-theme-changed";

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === "theme" || event.key === null) listener();
  };
  window.addEventListener(THEME_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THEME_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function toggle(): void {
  const next = getInitialTheme() === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  document.documentElement.classList.toggle("dark", next === "dark");
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return { theme, toggle };
}
