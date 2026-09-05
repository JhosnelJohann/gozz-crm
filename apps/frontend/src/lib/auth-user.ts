"use client";
import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  nombre: string;
  nivel: "super_admin" | "admin" | "usuario";
}

let cache: CurrentUser | null | undefined = undefined;
let inflight: Promise<CurrentUser | null> | null = null;

async function fetchMe(): Promise<CurrentUser | null> {
  try {
    const r = await fetch("/api/auth/me");
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.user) return null;
    // Normalizar: aceptar tanto 'nivel' como 'nivel_acceso' del backend
    const user = { ...d.user, nivel: d.user.nivel || d.user.nivel_acceso };
    return user as CurrentUser;
  } catch {
    return null;
  }
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null | undefined>(cache);

  useEffect(() => {
    if (cache !== undefined) { setUser(cache); return; }
    if (!inflight) inflight = fetchMe();
    inflight.then((u) => { cache = u; setUser(u); });
  }, []);

  const isAdmin = user?.nivel === "admin" || user?.nivel === "super_admin";
  const isSuperAdmin = user?.nivel === "super_admin";
  return { user, loading: user === undefined, isAdmin, isSuperAdmin };
}

export function initialsOf(nombre: string): string {
  if (!nombre) return "??";
  const parts = nombre.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")).toUpperCase();
}
