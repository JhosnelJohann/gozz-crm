"use client";
import { useEffect, useState } from "react";
import { getSocket } from "./socket";

export function useTareasPendientes(): number {
  const [total, setTotal] = useState(0);

  const refetch = async () => {
    try {
      // 🔴 `vinculo=asignado` EXPLÍCITO, y no el valor por defecto del endpoint.
      //
      // Desde el 2026-09-02 la pantalla de Tareas enseña por defecto las que creé además de las que
      // tengo asignadas. Aquí eso sería un error: este número es el globo del menú y significa
      // **lo que tengo que hacer yo**. Heredar el valor por defecto lo hincharía con las tareas que
      // le encargué a otras personas, y dejaría de querer decir lo que la gente lee que dice.
      // Decisión de Juan David en la misma entrega que cambió el valor por defecto.
      const r = await fetch("/api/tareas?scope=mine&vinculo=asignado&estado=pendiente");
      if (!r.ok) return;
      const d = await r.json();
      setTotal((d.tareas || []).length);
    } catch {}
  };

  useEffect(() => { refetch(); }, []);

  useEffect(() => {
    const socket = getSocket();
    const onAny = () => { refetch(); };
    socket.on("notificacion:nueva", onAny);
    socket.on("tarea:actualizada", onAny);
    socket.on("tarea:super-notify", onAny);
    const onVis = () => { if (document.visibilityState === "visible") refetch(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    // refetch periódico por si se completa en otra pestaña
    const t = setInterval(refetch, 60_000);
    return () => {
      socket.off("notificacion:nueva", onAny);
      socket.off("tarea:actualizada", onAny);
      socket.off("tarea:super-notify", onAny);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
    };
  }, []);

  return total;
}
