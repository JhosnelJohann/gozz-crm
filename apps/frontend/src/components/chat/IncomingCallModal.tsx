"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, Video, Users, Mic, PhoneIncoming, Sparkles } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";
import { initialsOf } from "@/lib/auth-user";
import { startRing, stopRing, startVibration, stopVibration, osNotify, requestNotificationPermission } from "@/lib/ringtone";

interface Miembro { id: string; nombre: string; foto_perfil_url?: string | null; }

interface Incoming {
  videollamadaId: string;
  nombreSala: string;
  tipo?: "1-1" | "grupo";
  grupo?: { id: string; nombre: string; avatar_url?: string | null; miembros_count?: number } | null;
  from: Miembro;
  otrosMiembros?: Miembro[];
}

export function IncomingCallModal() {
  const router = useRouter();
  const [call, setCall] = useState<Incoming | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Guardamos el id del timeout de auto-decline (45s) para poder CANCELARLO al
  // aceptar/rechazar/desmontar y evitar un "decline fantasma" tras haber atendido.
  const autoDeclineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedupe: el mismo videollamadaId puede llegar por REST + socket ring + re-ring.
  const activeIdRef = useRef<string | null>(null);
  const clearAutoDecline = () => {
    if (autoDeclineRef.current) { clearTimeout(autoDeclineRef.current); autoDeclineRef.current = null; }
  };

  // Request notification permission once
  useEffect(() => { requestNotificationPermission(); }, []);

  useEffect(() => {
    const socket = getSocket();
    console.log("[IncomingCallModal] listeners attached, socket id=", socket.id, "connected=", socket.connected);
    const onIncoming = (data: Incoming) => {
      console.log("[IncomingCallModal] received incoming call", data);
      if (activeIdRef.current === data.videollamadaId) return; // ya mostrando esta llamada
      activeIdRef.current = data.videollamadaId;
      setCall(data);
      setElapsed(0);
      startRing("incoming");
      startVibration();
      if (document.hidden) {
        osNotify(
          data.tipo === "grupo" ? `Videollamada grupal: ${data.grupo?.nombre || ""}` : "Videollamada entrante",
          `${data.from.nombre} te está llamando`,
          data.from.foto_perfil_url || "/logo-gozz.png"
        );
      }
      // Solo un timer activo a la vez. Si NADIE atiende en 45s, recién ahí declinamos
      // (y solo si el modal sigue mostrando ESTA misma llamada).
      clearAutoDecline();
      autoDeclineRef.current = setTimeout(() => {
        autoDeclineRef.current = null;
        setCall((cur) => {
          if (cur?.videollamadaId === data.videollamadaId) {
            stopRing(); stopVibration();
            socket.emit("videollamada:decline", { videollamadaId: data.videollamadaId, callerUserId: data.from.id });
            activeIdRef.current = null;
            return null;
          }
          return cur;
        });
      }, 45000);
    };
    const onCanceled = (data: { videollamadaId: string }) => {
      setCall((cur) => {
        if (cur?.videollamadaId === data.videollamadaId) {
          clearAutoDecline();
          stopRing(); stopVibration();
          activeIdRef.current = null;
          return null;
        }
        return cur;
      });
    };
    // La llamada fue atendida/rechazada en otra pestaña del mismo usuario -> dejar de sonar aca.
    const onHandled = (data: { videollamadaId: string }) => {
      setCall((cur) => {
        if (cur?.videollamadaId === data.videollamadaId) {
          clearAutoDecline(); stopRing(); stopVibration();
          activeIdRef.current = null;
          return null;
        }
        return cur;
      });
    };
    socket.on("videollamada:incoming", onIncoming);
    socket.on("videollamada:canceled", onCanceled);
    socket.on("videollamada:handled", onHandled);
    return () => {
      clearAutoDecline();
      socket.off("videollamada:incoming", onIncoming);
      socket.off("videollamada:canceled", onCanceled);
      socket.off("videollamada:handled", onHandled);
    };
  }, []);

  // Timer tick while ringing
  useEffect(() => {
    if (!call) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [call]);

  const accept = () => {
    if (!call) return;
    clearAutoDecline(); // cancelar el auto-decline: ya atendimos
    activeIdRef.current = null;
    const socket = getSocket();
    socket.emit("videollamada:accept", { videollamadaId: call.videollamadaId, callerUserId: call.from.id });
    socket.emit("videollamada:handled", { videollamadaId: call.videollamadaId });
    stopRing(); stopVibration();
    router.push(`/videollamada/${call.videollamadaId}`);
    setCall(null);
  };

  const decline = () => {
    if (!call) return;
    clearAutoDecline(); // cancelar el auto-decline: ya rechazamos manualmente
    activeIdRef.current = null;
    const socket = getSocket();
    socket.emit("videollamada:decline", { videollamadaId: call.videollamadaId, callerUserId: call.from.id });
    socket.emit("videollamada:handled", { videollamadaId: call.videollamadaId });
    stopRing(); stopVibration();
    setCall(null);
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <AnimatePresence>
      {call && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-8"
        >
          {/* Ambient backdrop con foto del caller difuminada */}
          <div className="absolute inset-0 bg-black/85 backdrop-blur-2xl" />
          {call.from.foto_perfil_url && (
            <div
              className="absolute inset-0 opacity-35"
              style={{
                backgroundImage: `url(${call.from.foto_perfil_url})`,
                backgroundSize: "cover", backgroundPosition: "center",
                filter: "blur(100px) saturate(1.4)", transform: "scale(1.15)",
              }}
            />
          )}
          <div className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: "radial-gradient(ellipse at 30% 20%, rgba(87,80,232,0.22), transparent 55%), radial-gradient(ellipse at 70% 80%, rgba(255,0,110,0.20), transparent 55%)" }} />

          {/* Status chip */}
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="relative z-10 inline-flex items-center gap-2 px-4 h-9 rounded-full bg-white/[0.08] border border-white/15 backdrop-blur-xl mb-6"
          >
            <motion.span
              animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]"
            />
            <PhoneIncoming className="h-3.5 w-3.5 text-white/80" strokeWidth={2.5} />
            <span className="text-[11px] font-inter font-bold uppercase tracking-[0.2em] text-white/85">
              {call.tipo === "grupo" ? "Videollamada grupal" : "Videollamada entrante"}
            </span>
          </motion.div>

          {call.tipo === "grupo" && call.grupo && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
              className="relative z-10 text-sm font-inter font-semibold text-white/75 mb-5 flex items-center gap-2"
            >
              <Users className="h-4 w-4 text-brand-orange" strokeWidth={2} />
              {call.grupo.nombre} · {call.grupo.miembros_count} participantes
            </motion.div>
          )}

          {/* Avatar stack con halos + rotación */}
          <motion.div
            initial={{ scale: 0.82, opacity: 0, filter: "blur(12px)" }}
            animate={{ scale: 1, opacity: 1, filter: "blur(0)" }}
            transition={{ type: "spring", stiffness: 160, damping: 18 }}
            className="relative z-10 mb-8"
          >
            {/* Glow halo multicolor */}
            <motion.div
              animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -inset-10 rounded-full bg-gradient-to-br from-brand-orange/35 via-neon-magenta/30 to-neon-purple/25 blur-3xl pointer-events-none"
            />
            {/* Rings expansivos (3 capas) */}
            {[0, 0.55, 1.1].map((delay, i) => (
              <motion.div
                key={i}
                animate={{ scale: [1, 1.7], opacity: [0.55, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay }}
                className={"absolute inset-0 rounded-full border-2 " + (i === 0 ? "border-brand-orange" : i === 1 ? "border-neon-magenta" : "border-neon-purple")}
              />
            ))}
            {/* Avatar 220px con anillo conic rotando */}
            <div className="relative h-[220px] w-[220px] rounded-full p-[4px] bg-[conic-gradient(from_var(--a,0deg),#5750E8,#FFB51C,#FF006E,#8338EC,#5750E8)] shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
              style={{ animation: "spin-slow 8s linear infinite" }}>
              <div className="h-full w-full rounded-full overflow-hidden bg-[#0A0A12] flex items-center justify-center text-white text-6xl font-inter font-black">
                {call.from.foto_perfil_url ? (
                  <img src={call.from.foto_perfil_url} alt={call.from.nombre} className="h-full w-full object-cover" />
                ) : (
                  initialsOf(call.from.nombre)
                )}
              </div>
            </div>

            {/* Iconos mini permisos */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-2"
            >
              <div className="h-9 w-9 rounded-full bg-[#0F0F1B] border border-white/15 shadow-lg flex items-center justify-center">
                <Video className="h-4 w-4 text-brand-orange" strokeWidth={2.2} />
              </div>
              <div className="h-9 w-9 rounded-full bg-[#0F0F1B] border border-white/15 shadow-lg flex items-center justify-center">
                <Mic className="h-4 w-4 text-emerald-400" strokeWidth={2.2} />
              </div>
            </motion.div>

            {/* Secondary avatars (grupo) */}
            {call.tipo === "grupo" && call.otrosMiembros && call.otrosMiembros.length > 0 && (
              <div className="absolute -bottom-4 -right-4 flex -space-x-3 z-10">
                {call.otrosMiembros.slice(0, 3).map((m) => (
                  <div key={m.id} className="h-12 w-12 rounded-full overflow-hidden border-4 border-[#0A0A12] bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white text-[10px] font-inter font-bold shadow-lg">
                    {m.foto_perfil_url ? <img src={m.foto_perfil_url} alt={m.nombre} className="h-full w-full object-cover" /> : initialsOf(m.nombre)}
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Name */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative z-10 font-inter text-4xl sm:text-5xl font-extrabold text-white text-center mb-1 tracking-tight"
          >
            {call.from.nombre}
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
            className="relative z-10 flex items-center gap-2 text-sm text-white/65 font-inter mb-1"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-orange" strokeWidth={2.2} />
            <span>te está llamando</span>
          </motion.div>
          <div className="relative z-10 text-xs text-white/40 font-mono tabular-nums mb-10">{mm}:{ss}</div>

          {/* Waveform equalizer */}
          <div className="relative z-10 flex items-end gap-1 h-6 mb-6">
            {Array.from({ length: 11 }).map((_, i) => (
              <motion.div
                key={i}
                animate={{ scaleY: [0.3, 1, 0.5, 0.9, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.07, ease: "easeInOut" }}
                style={{ transformOrigin: "bottom" }}
                className="w-[4px] h-full rounded-full bg-gradient-to-t from-brand-orange via-neon-magenta to-neon-purple"
              />
            ))}
          </div>

          {/* Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, type: "spring", stiffness: 260, damping: 22 }}
            className="relative z-10 flex items-center gap-8 sm:gap-14"
          >
            <motion.button
              onClick={decline}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
              className="group flex flex-col items-center gap-2"
            >
              <div className="relative h-[70px] w-[70px] rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white shadow-[0_15px_40px_rgba(239,68,68,0.55)] ring-4 ring-red-500/20">
                <motion.span
                  animate={{ scale: [1, 1.7], opacity: [0.6, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-red-500"
                />
                <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 2, repeat: Infinity }} className="relative">
                  <PhoneOff className="h-7 w-7" strokeWidth={2.4} />
                </motion.div>
              </div>
              <div className="text-[11px] font-inter font-bold uppercase tracking-[0.2em] text-white/75">Rechazar</div>
            </motion.button>

            <motion.button
              onClick={accept}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              className="group flex flex-col items-center gap-2"
            >
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                className="relative h-[80px] w-[80px] rounded-full bg-gradient-to-br from-emerald-400 via-green-500 to-emerald-600 flex items-center justify-center text-white shadow-[0_20px_60px_rgba(16,185,129,0.65)] ring-4 ring-emerald-400/25"
              >
                <motion.span
                  animate={{ scale: [1, 1.6], opacity: [0.7, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="absolute inset-0 rounded-full bg-emerald-400"
                />
                <motion.div
                  animate={{ rotate: [0, -8, 8, -8, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  className="relative"
                >
                  <Phone className="h-8 w-8 fill-white/15" strokeWidth={2.4} />
                </motion.div>
              </motion.div>
              <div className="text-[11px] font-inter font-bold uppercase tracking-[0.2em] text-white/75">Aceptar</div>
            </motion.button>
          </motion.div>

          <div className="relative z-10 mt-6 text-[10px] text-white/35 font-inter uppercase tracking-[0.25em]">
            El CRM oficial · Videollamada segura
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
