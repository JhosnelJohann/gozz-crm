// Set en memoria de los grupos que el usuario tiene SILENCIADOS.
// Los notificadores globales (ChatNotifier / MessageToast) lo consultan para NO sonar ni
// mostrar toast en chats silenciados. Silenciar NO afecta la entrega del mensaje: el chat
// sigue sumando no leídos y subiendo en la lista; aquí solo se calla el aviso.

let muted = new Set<string>();
let started = false;

export async function refreshMuted(): Promise<void> {
  try {
    const r = await fetch("/api/chat/silenciados");
    if (!r.ok) return;
    const d = await r.json();
    muted = new Set<string>((d.grupo_ids || []).map((x: any) => String(x)));
  } catch {
    /* silencioso: si falla, no silenciamos nada (comportamiento seguro) */
  }
}

export function isMuted(grupoId: string | null | undefined): boolean {
  return !!grupoId && muted.has(String(grupoId));
}

// Actualización optimista al silenciar/activar desde el sidebar (antes de que responda el PATCH).
export function setMutedLocal(grupoId: string, value: boolean): void {
  if (value) muted.add(String(grupoId));
  else muted.delete(String(grupoId));
}

// Inicializa la sincronización: fetch inicial + re-fetch ante el evento global `chat:muted:changed`.
// Idempotente — se puede llamar desde varios componentes.
export function initMutedSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  refreshMuted();
  window.addEventListener("chat:muted:changed", () => { refreshMuted(); });
}
