"use client";
import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    const theme: "dark" | "light" = stored === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);
  return <>{children}</>;
}

export function useThemeToggle() {
  return () => {
    const isDark = document.documentElement.classList.contains("dark");
    const next = isDark ? "light" : "dark";
    document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("theme", next); } catch {}
  };
}
