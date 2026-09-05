/* GOZZ CRM — Service Worker para Web Push (chat, llamadas, tareas).
   Sirve desde /sw.js (scope raiz). Siempre muestra la notificacion, estilo WhatsApp. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const EMOJI = { chat: "💬 ", llamada: "📞 ", tarea: "✅ ", general: "" };

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
    const kind = data.kind || "general";

    const actions = [];
    if (kind === "chat" && data.grupoId) {
      actions.push({ action: "responder", type: "text", title: "Responder", placeholder: "Escribe tu respuesta" });
    }

    // Anti doble-ping (solo chat): si hay alguna pestaña del CRM abierta, el push va SILENCIOSO
    // (el ping in-app de la app pone el sonido). Con la app cerrada, el push suena normal.
    // Los demás tipos (tarea/llamada/general) conservan su sonido siempre.
    let silent = false;
    if (kind === "chat") {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      silent = wins.length > 0;
    }

    const title = (EMOJI[kind] || "") + (data.title || "GOZZ CRM");
    const options = {
      body: data.body || "",
      icon: data.icon || "/logo-gozz.png",
      badge: "/logo-gozz.png",
      image: data.image || undefined,
      tag: data.tag || undefined,
      renotify: !!data.tag,
      requireInteraction: !!data.requireInteraction,
      silent,
      timestamp: Date.now(),
      actions,
      data: { url: data.url || "/", grupoId: data.grupoId || null, kind },
    };
    // La spec PROHÍBE `vibrate` junto con `silent: true` (lanza TypeError y el banner NO se muestra).
    // Por eso solo agregamos vibración cuando el push NO es silencioso.
    if (!silent) {
      options.vibrate = kind === "llamada" ? [200, 100, 200, 100, 200, 100, 200] : [120, 60, 120];
    }
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  const d = event.notification.data || {};

  // Responder desde la notificacion (estilo WhatsApp)
  if (event.action === "responder" && d.grupoId && event.reply) {
    event.notification.close();
    event.waitUntil(
      fetch(`/api/chat/grupos/${d.grupoId}/mensajes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenido: event.reply }),
      }).catch(() => {})
    );
    return;
  }

  event.notification.close();
  const targetUrl = d.url || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c && targetUrl) { try { await c.navigate(targetUrl); } catch (e) {} }
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
