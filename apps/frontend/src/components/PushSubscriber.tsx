"use client";
// Registra/actualiza el SW, pide permiso automaticamente y suscribe. Ademas
// muestra un banner persistente para quien aun no activo las notificaciones,
// para impulsar la adopcion del equipo.
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, MessageSquare, Phone, CheckSquare, AlertTriangle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";

const WELCOMED_KEY = "crm-push-welcomed";
const SNOOZE_KEY = "crm-push-banner-snooze"; // sessionStorage: oculta el banner esta sesion

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeAndWelcome(reg: ServiceWorkerRegistration): Promise<boolean> {
  try {
    const keyRes = await fetch("/api/push/vapid-public-key", { cache: "no-store" }).then((r) => r.json());
    const vapid = keyRes?.key;
    if (!vapid) return false;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapid) as unknown as BufferSource,
      });
    }
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    try {
      if (!localStorage.getItem(WELCOMED_KEY)) {
        localStorage.setItem(WELCOMED_KEY, String(Date.now()));
        await reg.showNotification("✅ Notificaciones activadas", {
          body: "Asi te avisaremos de mensajes, llamadas y tareas del CRM.",
          icon: "/logo-gozz.png",
          badge: "/logo-gozz.png",
          tag: "crm-bienvenida",
        });
      }
    } catch { /* noop */ }
    return true;
  } catch {
    return false;
  }
}

export function PushSubscriber() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("granted");
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
    setSnoozed(sessionStorage.getItem(SNOOZE_KEY) === "1");

    let asked = false;
    let cleanup = () => {};
    (async () => {
      try {
        const r = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        setReg(r);
        try { await r.update(); } catch { /* noop */ }
        await navigator.serviceWorker.ready;

        const ask = async () => {
          if (asked) return;
          asked = true;
          cleanup();
          try {
            const p = await Notification.requestPermission();
            setPerm(p);
            if (p === "granted") {
              const ok = await subscribeAndWelcome(r);
              if (ok) toast.success("Notificaciones activadas");
            }
          } catch { /* noop */ }
        };

        if (Notification.permission === "granted") {
          await subscribeAndWelcome(r);
        } else if (Notification.permission === "default") {
          ask();
          window.addEventListener("pointerdown", ask, { once: true });
          window.addEventListener("keydown", ask, { once: true });
          cleanup = () => {
            window.removeEventListener("pointerdown", ask);
            window.removeEventListener("keydown", ask);
          };
        }
      } catch { /* noop */ }
    })();

    return () => cleanup();
  }, []);

  const activar = async () => {
    if (perm === "denied") {
      toast.error("Las notificaciones estan bloqueadas en tu navegador", {
        description: "Haz clic en el candado 🔒 junto a la direccion web → Notificaciones → Permitir, y recarga.",
        duration: 9000,
      });
      return;
    }
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p === "granted" && reg) {
        const ok = await subscribeAndWelcome(reg);
        if (ok) toast.success("¡Listo! Notificaciones activadas");
      } else if (p === "denied") {
        toast.error("Las bloqueaste. Actívalas desde el candado 🔒 de la barra de direcciones.");
      }
    } catch { /* noop */ }
  };

  const snooze = () => {
    setSnoozed(true);
    try { sessionStorage.setItem(SNOOZE_KEY, "1"); } catch {}
  };

  const visible = perm !== "granted" && perm !== "unsupported" && !snoozed;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
          className="fixed bottom-5 right-5 z-[80] w-[350px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white shadow-2xl border border-neutral-100 overflow-hidden"
        >
          <div className="h-1 gradient-orange" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <motion.div
                animate={{ rotate: [0, -12, 12, -8, 8, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2 }}
                className="h-10 w-10 rounded-xl gradient-orange text-white flex items-center justify-center shrink-0 shadow-glow"
              >
                <Bell className="h-5 w-5" strokeWidth={2.2} />
              </motion.div>
              <div className="flex-1 min-w-0">
                <h4 className="font-display font-black text-[15px] leading-tight">Activa las notificaciones</h4>
                <p className="text-[12.5px] text-neutral-500 mt-0.5 leading-snug">No te pierdas mensajes, llamadas ni tareas, aunque tengas el CRM en otra pestaña.</p>
              </div>
              <button onClick={snooze} className="h-7 w-7 rounded-lg hover:bg-neutral-100 text-neutral-400 flex items-center justify-center shrink-0" title="Ahora no">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 mt-3 mb-3.5 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2} /> Mensajes</span>
              <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-brand-green" strokeWidth={2} /> Llamadas</span>
              <span className="inline-flex items-center gap-1"><CheckSquare className="h-3.5 w-3.5 text-brand-orange" strokeWidth={2} /> Tareas</span>
            </div>

            {perm === "denied" && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" strokeWidth={2} />
                <span>Las bloqueaste antes. Actívalas en el candado 🔒 de la barra de direcciones → Notificaciones → Permitir.</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={activar}
                className="flex-1 gradient-orange h-10 rounded-xl text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-glow hover:opacity-95 transition"
              >
                {perm === "denied" ? "Cómo activarlas" : "Activar notificaciones"}
              </button>
              <button onClick={snooze} className="h-10 px-3 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-400 hover:bg-neutral-100 transition">
                Ahora no
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
