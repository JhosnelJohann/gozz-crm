"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSocket } from "./socket";

/**
 * Total de no leídos de WhatsApp para la insignia del menú lateral (mismo lugar que
 * `useChatUnread`). A diferencia del chat interno, WhatsApp no emite un evento de socket cuando
 * algo se marca como leído (`marcarLeida` no hace `notifyEvento`) — por eso este hook no intenta
 * sumar/restar a mano como `useChatUnread` y en su lugar vuelve a pedir el total real al backend
 * cada vez que algo pudo haber cambiado. Es una sola consulta `SUM`, no la lista completa.
 */
export function useWhatsappUnread(): number {
  const [total, setTotal] = useState(0);
  const pathname = usePathname();

  const refetch = async () => {
    try {
      const r = await fetch("/api/whatsapp/no-leidos");
      if (!r.ok) return;
      const d = await r.json();
      setTotal(d.total || 0);
    } catch {}
  };

  useEffect(() => { refetch(); }, []);

  useEffect(() => {
    const socket = getSocket();
    const onMensaje = () => refetch();
    socket.on("whatsapp:mensaje", onMensaje);
    const onVis = () => { if (document.visibilityState === "visible") refetch(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      socket.off("whatsapp:mensaje", onMensaje);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Al entrar o salir de /whatsapp el usuario probablemente marcó conversaciones como leídas.
  useEffect(() => {
    const t = setTimeout(() => refetch(), 500);
    return () => clearTimeout(t);
  }, [pathname]);

  return total;
}
