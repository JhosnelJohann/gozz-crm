"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PhoneOff, Phone, Video, PhoneMissed, PhoneIncoming, Mic, Sparkles } from "@/lib/bootstrap-icons";
import { initialsOf } from "@/lib/auth-user";
import { startRing, stopRing } from "@/lib/ringtone";

interface Props {
  open: boolean;
  target: { id: string; nombre: string; foto_perfil_url?: string | null } | null;
  status: "ringing" | "declined" | "timeout";
  onCancel: () => void;
}

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function OutgoingCallOverlay({ open, target, status, onCancel }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (open && status === "ringing") {
      startRing("outgoing");
      return () => stopRing();
    }
  }, [open, status]);

  useEffect(() => {
    if (!open || status !== "ringing") { setElapsed(0); return; }
    const started = Date.now();
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(i);
  }, [open, status]);

  const isRinging = status === "ringing";
  const StatusIcon = status === "declined" ? PhoneMissed : status === "timeout" ? PhoneOff : Phone;

  return (
    <AnimatePresence>
      {open && target && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[99] flex items-center justify-center p-6"
        >
          {/* Ambient backdrop con foto difuminada */}
          <div className="absolute inset-0 bg-black/75 backdrop-blur-xl" />
          {target.foto_perfil_url && (
            <div
              className="absolute inset-0 opacity-30"
              style={{
                backgroundImage: `url(${target.foto_perfil_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(80px) saturate(1.3)",
                transform: "scale(1.2)",
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a14]/60 via-transparent to-[#1a0f20]/70" />

          {/* Card */}
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0, filter: "blur(12px)" }}
            animate={{ scale: 1, y: 0, opacity: 1, filter: "blur(0)" }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="relative w-full max-w-sm rounded-[32px] overflow-hidden bg-[rgba(10,10,18,0.88)] border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.5)]"
          >
            {/* Border beam */}
            <div className="pointer-events-none absolute inset-0 rounded-[32px] border-beam opacity-60" />

            {/* Mesh gradient suave */}
            <div className="absolute inset-0 opacity-50 pointer-events-none"
              style={{ backgroundImage: "radial-gradient(ellipse at 25% 15%, rgba(87,80,232,0.22), transparent 55%), radial-gradient(ellipse at 75% 85%, rgba(255,0,110,0.20), transparent 55%)" }} />

            <div className="relative px-8 pt-10 pb-8 flex flex-col items-center text-center">
              {/* Status chip */}
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-1.5 px-3 h-7 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-xl text-[10px] font-inter font-bold uppercase tracking-[0.2em] text-white/70 mb-6"
              >
                {isRinging && <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping" /><span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" /></span>}
                <StatusIcon className="h-3 w-3" strokeWidth={2.5} />
                {isRinging ? "Llamando" : status === "declined" ? "Rechazada" : "Sin respuesta"}
              </motion.div>

              {/* Avatar con halos */}
              <div className="relative mb-6">
                {isRinging && (
                  <>
                    {[0, 0.5, 1].map((d, i) => (
                      <motion.div
                        key={i}
                        animate={{ scale: [1, 1.85], opacity: [0.45, 0] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut", delay: d }}
                        className={"absolute inset-0 rounded-full border-2 " + (i === 0 ? "border-brand-orange/60" : i === 1 ? "border-neon-magenta/50" : "border-neon-purple/45")}
                      />
                    ))}
                    {/* Glow halo */}
                    <motion.div
                      animate={{ opacity: [0.4, 0.8, 0.4] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute -inset-6 rounded-full bg-gradient-to-br from-brand-orange/30 via-neon-magenta/25 to-neon-purple/20 blur-2xl pointer-events-none"
                    />
                  </>
                )}
                <div className="relative h-32 w-32 rounded-full p-[3px] bg-[conic-gradient(from_var(--a,0deg),#5750E8,#FF006E,#8338EC,#5750E8)] shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
                  style={{ animation: isRinging ? "spin-slow 6s linear infinite" : undefined }}>
                  <div className="h-full w-full rounded-full overflow-hidden bg-[#0A0A12] flex items-center justify-center text-white text-3xl font-inter font-black">
                    {target.foto_perfil_url ? (
                      <img src={target.foto_perfil_url} alt={target.nombre} className="h-full w-full object-cover" />
                    ) : (
                      initialsOf(target.nombre)
                    )}
                  </div>
                </div>

                {/* Mini chips de permisos */}
                {isRinging && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5"
                  >
                    <div className="h-7 w-7 rounded-full bg-[#111124] border border-white/15 shadow-lg flex items-center justify-center">
                      <Video className="h-3.5 w-3.5 text-brand-orange" strokeWidth={2.2} />
                    </div>
                    <div className="h-7 w-7 rounded-full bg-[#111124] border border-white/15 shadow-lg flex items-center justify-center">
                      <Mic className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.2} />
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Nombre + estado */}
              <div className="font-inter text-[22px] font-extrabold text-white mb-1 tracking-tight">{target.nombre}</div>
              <motion.div
                key={status}
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="text-[13px] text-white/65 font-inter font-medium flex items-center gap-2"
              >
                {isRinging ? (
                  <>
                    <Sparkles className="h-3 w-3 text-brand-orange" strokeWidth={2.2} />
                    <span>Esperando que conteste…</span>
                    <span className="tabular-nums text-white/55">· {formatElapsed(elapsed)}</span>
                  </>
                ) : (
                  <span>{status === "declined" ? "El usuario rechazó la llamada" : "Sin respuesta"}</span>
                )}
              </motion.div>

              {/* Waveform equalizer (visual feedback del ringtone) */}
              {isRinging && (
                <div className="mt-5 flex items-end gap-[3px] h-5">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ scaleY: [0.4, 1, 0.6, 1, 0.3] }}
                      transition={{ duration: 1.3, repeat: Infinity, delay: i * 0.07, ease: "easeInOut" }}
                      style={{ transformOrigin: "bottom" }}
                      className="w-[3px] h-full rounded-full bg-gradient-to-t from-brand-orange to-neon-magenta"
                    />
                  ))}
                </div>
              )}

              {/* Colgar button */}
              <motion.button
                onClick={onCancel}
                whileHover={isRinging ? { scale: 1.06 } : undefined}
                whileTap={{ scale: 0.95 }}
                className="mt-8 relative h-16 w-16 rounded-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white shadow-[0_10px_40px_rgba(239,68,68,0.5)] transition ring-4 ring-red-500/20"
              >
                {isRinging && (
                  <motion.span
                    animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                    className="absolute inset-0 rounded-full bg-red-500"
                  />
                )}
                <PhoneOff className="relative h-6 w-6" strokeWidth={2.4} />
              </motion.button>
              <div className="mt-2 text-[10px] font-inter uppercase tracking-[0.2em] text-white/40">Colgar</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
