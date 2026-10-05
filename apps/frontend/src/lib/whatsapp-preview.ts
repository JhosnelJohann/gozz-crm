// Texto corto de un mensaje de WhatsApp para la lista, las citas y las notificaciones. Misma
// lógica que `previewDe` del backend (apps/api/src/modules/whatsapp/mensaje-parser.ts).
export function previewDe(msg: { contenido?: string | null; tipo: string; archivo_nombre?: string | null; autor_nombre?: string | null; direccion?: string; eliminado_at?: string | null }): string {
  const json = <T,>(): T | null => { try { return msg.contenido ? JSON.parse(msg.contenido) : null; } catch { return null; } };
  let base: string;
  if (msg.eliminado_at) base = "🚫 Mensaje eliminado";
  else if (msg.tipo === "texto" || msg.tipo === "sistema") base = msg.contenido || "";
  else if (msg.tipo === "imagen") base = msg.contenido ? `📷 ${msg.contenido}` : "📷 Foto";
  else if (msg.tipo === "video") base = msg.contenido ? `🎥 ${msg.contenido}` : "🎥 Video";
  else if (msg.tipo === "audio") base = "🎤 Nota de voz";
  else if (msg.tipo === "sticker") base = "Sticker";
  else if (msg.tipo === "archivo") base = `📄 ${msg.archivo_nombre || msg.contenido || "Documento"}`;
  else if (msg.tipo === "ubicacion") base = `📍 ${json<{ nombre?: string }>()?.nombre || "Ubicación"}`;
  else if (msg.tipo === "contacto") base = `👤 ${json<{ nombre: string }[]>()?.[0]?.nombre || "Contacto"}`;
  else if (msg.tipo === "encuesta") base = `📊 ${json<{ pregunta: string }>()?.pregunta || "Encuesta"}`;
  else base = msg.contenido || "Mensaje";
  // En grupos, como en WhatsApp: "Jair: Sticker".
  return msg.autor_nombre && msg.direccion === "entrante" ? `${msg.autor_nombre}: ${base}` : base;
}
