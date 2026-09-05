"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getSocket } from "./socket";
import { getActiveChat } from "./chatActive";

export function useChatUnread(): number {
  const [total, setTotal] = useState(0);
  const pathname = usePathname();
  const pathRef = useRef<string>(pathname || "");
  const meIdRef = useRef<string | null>(null);

  useEffect(() => { pathRef.current = pathname || ""; }, [pathname]);

  const refetch = async () => {
    try {
      const r = await fetch("/api/chat/grupos");
      if (!r.ok) return;
      const d = await r.json();
      const sum = (d.grupos || []).reduce((s: number, g: any) => s + (g.unread_count || 0), 0);
      setTotal(sum);
    } catch {}
  };

  useEffect(() => {
    let cancel = false;
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancel) meIdRef.current = d?.user?.id ?? null; })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  useEffect(() => { refetch(); }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMsg = (m: any) => {
      if (!m) return;
      // no cuentes tus propios mensajes
      if (meIdRef.current && m.user_id === meIdRef.current) return;
      // si estoy viendo ese chat activo no cuenta
      if (pathRef.current === "/chat" && getActiveChat() === m.grupo_id && typeof document !== "undefined" && document.visibilityState === "visible") return;
      setTotal((t) => t + 1);
    };
    const onRead = () => { refetch(); };
    socket.on("chat:message", onMsg);
    socket.on("chat:read", onRead);
    // refetch cuando la pestaña vuelve a enfoco
    const onVis = () => { if (document.visibilityState === "visible") refetch(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => {
      socket.off("chat:message", onMsg);
      socket.off("chat:read", onRead);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Reset cuando navegas a /chat
  useEffect(() => {
    if (pathname === "/chat") {
      // Pequeño delay para permitir que el marcador de leído corra en backend
      const t = setTimeout(() => refetch(), 400);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  return total;
}
