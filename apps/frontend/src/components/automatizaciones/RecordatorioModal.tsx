"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, WhatsappLogo, Envelope } from "@/lib/bootstrap-icons";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ContactoPicker } from "@/components/oportunidad/ContactoPicker";
import type { RecordatorioCanal } from "./types";
import type { WhatsAppConexion } from "@/components/whatsapp/types";

interface ConversacionOpcion {
  id: string;
  nombre_whatsapp: string | null;
  wa_jid: string;
}

interface BuzonOpcion {
  id: string;
  email: string;
  display_name: string | null;
  auth_type?: string | null;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const inputCls = "w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30";

export function RecordatorioModal({ onClose, onSaved }: Props) {
  const [canal, setCanal] = useState<RecordatorioCanal>("whatsapp");
  const [conexiones, setConexiones] = useState<WhatsAppConexion[]>([]);
  const [conexionId, setConexionId] = useState("");
  const [conversaciones, setConversaciones] = useState<ConversacionOpcion[]>([]);
  const [conversacionId, setConversacionId] = useState("");
  const [buzones, setBuzones] = useState<BuzonOpcion[]>([]);
  const [buzonId, setBuzonId] = useState("");
  const [contactoId, setContactoId] = useState("");
  const [contactoNombre, setContactoNombre] = useState<string | null>(null);
  const [asunto, setAsunto] = useState("Recordatorio");
  const [mensaje, setMensaje] = useState("");
  const [programadoPara, setProgramadoPara] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    fetch("/api/whatsapp/conexiones").then((r) => r.json()).then((d) => setConexiones(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/buzones").then((r) => r.json()).then((d) => setBuzones((d.buzones || []).filter((b: BuzonOpcion) => (b.auth_type || "password") === "password"))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!conexionId) { setConversaciones([]); setConversacionId(""); return; }
    fetch(`/api/whatsapp/conexiones/${conexionId}/conversaciones`)
      .then((r) => r.json())
      .then((d) => setConversaciones(d.conversaciones || []))
      .catch(() => {});
  }, [conexionId]);

  const guardar = async () => {
    if (!mensaje.trim()) { toast.error("Escribe el mensaje del recordatorio"); return; }
    if (!programadoPara) { toast.error("Elige cuándo enviarlo"); return; }
    if (canal === "whatsapp" && !conversacionId) { toast.error("Elige la conversación de WhatsApp"); return; }
    if (canal === "email" && (!contactoId || !buzonId)) { toast.error("Elige el contacto y el buzón que envía"); return; }

    setGuardando(true);
    try {
      const r = await fetch("/api/automatizaciones/recordatorios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canal,
          conversacionId: canal === "whatsapp" ? conversacionId : null,
          contactoId: canal === "email" ? contactoId : null,
          buzonId: canal === "email" ? buzonId : null,
          asunto: canal === "email" ? asunto : null,
          mensaje,
          programadoPara: new Date(programadoPara).toISOString(),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear el recordatorio");
      toast.success("Recordatorio programado");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl glass-panel p-6 max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-xl gradient-orange text-white flex items-center justify-center shrink-0">
              <Clock className="h-5 w-5" weight="duotone" />
            </div>
            <h2 className="font-display text-xl font-black flex-1">Nuevo recordatorio</h2>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setCanal("whatsapp")}
                className={cn("flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition", canal === "whatsapp" ? "gradient-orange text-white" : "bg-black/5 dark:bg-white/10 text-neutral-500")}
              >
                <WhatsappLogo className="h-4 w-4" weight="duotone" /> WhatsApp
              </button>
              <button
                onClick={() => setCanal("email")}
                className={cn("flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition", canal === "email" ? "gradient-orange text-white" : "bg-black/5 dark:bg-white/10 text-neutral-500")}
              >
                <Envelope className="h-4 w-4" weight="duotone" /> Correo
              </button>
            </div>

            {canal === "whatsapp" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Conexión</label>
                  <select value={conexionId} onChange={(e) => setConexionId(e.target.value)} className={inputCls}>
                    <option value="">Elige una…</option>
                    {conexiones.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Conversación</label>
                  <select value={conversacionId} onChange={(e) => setConversacionId(e.target.value)} disabled={!conexionId} className={cn(inputCls, "disabled:opacity-50")}>
                    <option value="">Elige una…</option>
                    {conversaciones.map((c) => <option key={c.id} value={c.id}>{c.nombre_whatsapp || c.wa_jid.split("@")[0]}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Contacto</label>
                  <ContactoPicker value={contactoId} selectedNombre={contactoNombre} onChange={(id, nombre) => { setContactoId(id); setContactoNombre(nombre || null); }} />
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Buzón que lo envía</label>
                  <select value={buzonId} onChange={(e) => setBuzonId(e.target.value)} className={inputCls}>
                    <option value="">Elige uno…</option>
                    {buzones.map((b) => <option key={b.id} value={b.id}>{b.display_name || b.email}</option>)}
                  </select>
                  {buzones.length === 0 && <p className="text-[11px] text-amber-600 mt-1.5">No hay buzones con contraseña conectados (los de Gmail/OAuth todavía no se pueden usar para recordatorios).</p>}
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Asunto</label>
                  <input value={asunto} onChange={(e) => setAsunto(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Mensaje</label>
              <textarea
                value={mensaje} onChange={(e) => setMensaje(e.target.value)} rows={4}
                placeholder="No olvides tu cita de mañana a las 3pm…"
                className="w-full px-4 py-3 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-primary/30 resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Enviar el</label>
              <input type="datetime-local" value={programadoPara} onChange={(e) => setProgramadoPara(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button onClick={guardar} disabled={guardando} className="flex-1">{guardando ? "Programando…" : "Programar"}</Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
