"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { Button } from "@/components/ui/Button";
import { X, WhatsappLogo, CheckCircle2, XCircle } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";

interface Props {
  onClose: () => void;
  onConnected: (conexionId: string) => void;
}

type Fase = "nombre" | "esperando-qr" | "qr" | "conectando" | "conectado" | "error";

export function ConnectWhatsAppModal({ onClose, onConnected }: Props) {
  const [nombre, setNombre] = useState("");
  const [fase, setFase] = useState<Fase>("nombre");
  const [qr, setQr] = useState<string | null>(null);
  const [conexionId, setConexionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conexionId) return;
    const socket = getSocket();
    const onQr = (ev: any) => { if (ev.conexion_id === conexionId) { setQr(ev.qr); setFase("qr"); } };
    const onEstado = (ev: any) => {
      if (ev.conexion_id !== conexionId) return;
      if (ev.estado === "conectando") setFase("conectando");
      else if (ev.estado === "conectado") { setFase("conectado"); setTimeout(() => onConnected(conexionId), 900); }
      else if (ev.estado === "error") { setFase("error"); setError(ev.error || "No se pudo conectar"); }
    };
    // Un socket que nunca autentica/conecta no dispara ningún evento — sin esto el modal se
    // queda girando para siempre y nadie se entera de que el problema es la conexión en tiempo
    // real, no WhatsApp. Se avisa apenas se sabe (connect_error) y, si aun así nada llega, con
    // un plazo tope.
    const onConnectError = (e: any) => {
      setFase("error");
      setError("No se pudo abrir la conexión en tiempo real (" + (e?.message || "error de red") + "). Revisa tu conexión e intenta de nuevo.");
    };
    socket.on("whatsapp:qr", onQr);
    socket.on("whatsapp:estado", onEstado);
    socket.on("connect_error", onConnectError);

    const plazo = setTimeout(() => {
      setFase((f) => {
        if (f === "esperando-qr" || f === "conectando") {
          setError("No llegó el código QR a tiempo. Puede ser un problema de conexión en tiempo real — intenta de nuevo.");
          return "error";
        }
        return f;
      });
    }, 25000);

    return () => {
      socket.off("whatsapp:qr", onQr);
      socket.off("whatsapp:estado", onEstado);
      socket.off("connect_error", onConnectError);
      clearTimeout(plazo);
    };
  }, [conexionId, onConnected]);

  const crear = async () => {
    if (nombre.trim().length < 2) { toast.error("Ponle un nombre a la conexión (ej. \"Ventas USA\")"); return; }
    setFase("esperando-qr");
    try {
      const r = await fetch("/api/whatsapp/conexiones", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear la conexión");
      setConexionId(d.conexion.id);
      const r2 = await fetch(`/api/whatsapp/conexiones/${d.conexion.id}/iniciar`, { method: "POST" });
      if (!r2.ok) throw new Error("No se pudo iniciar la conexión");
    } catch (e: any) {
      setFase("error"); setError(e.message);
    }
  };

  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-sm glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-green to-emerald-600 flex items-center justify-center text-white">
          <WhatsappLogo className="h-4.5 w-4.5" weight="fill" />
        </div>
        <div className="flex-1 font-display font-black text-sm">Conectar WhatsApp</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-6 flex flex-col items-center text-center min-h-[280px] justify-center">
        {fase === "nombre" && (
          <div className="w-full space-y-3">
            <p className="text-xs text-neutral-500">Dale un nombre a esta conexión para identificarla en el equipo.</p>
            <input
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && crear()}
              placeholder="Ej. Ventas USA"
              className="w-full h-11 px-4 rounded-xl bg-bg-surface-2 dark:bg-white/[0.05] border border-black/10 dark:border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            />
            <Button onClick={crear} className="w-full">Continuar</Button>
          </div>
        )}

        {(fase === "esperando-qr" || fase === "conectando") && (
          <div className="space-y-3">
            <div className="h-10 w-10 mx-auto rounded-full border-2 border-brand-primary/30 border-t-brand-primary animate-spin" />
            <p className="text-xs text-neutral-500">{fase === "esperando-qr" ? "Generando código QR…" : "Confirmando conexión…"}</p>
          </div>
        )}

        {fase === "qr" && qr && (
          <div className="space-y-3">
            <div className="p-3 bg-white rounded-2xl shadow-inner inline-block">
              <QRCodeSVG value={qr} size={200} level="M" />
            </div>
            <p className="text-xs text-neutral-500 max-w-[240px]">
              Abre WhatsApp en el teléfono → <strong>Dispositivos vinculados</strong> → <strong>Vincular un dispositivo</strong>, y escanea este código.
            </p>
          </div>
        )}

        {fase === "conectado" && (
          <div className="space-y-2">
            <CheckCircle2 className="h-12 w-12 text-brand-green mx-auto" weight="fill" />
            <p className="text-sm font-bold text-brand-green">¡Conectado!</p>
          </div>
        )}

        {fase === "error" && (
          <div className="space-y-3">
            <XCircle className="h-10 w-10 text-brand-red mx-auto" weight="fill" />
            <p className="text-xs text-brand-red">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => setFase("nombre")}>Intentar de nuevo</Button>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
