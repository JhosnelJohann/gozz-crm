"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquareMore, Sparkles, AlertCircle } from "@/lib/bootstrap-icons";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

interface ChatRow {
  id: string;                 // grupo_id
  tarea_id: string;
  tarea_titulo: string;
  tarea_estado: string;
  prioridad: "baja" | "normal" | "alta" | "urgente";
  ultimo_mensaje: string | null;
  ultimo_mensaje_at: string | null;
  unread_count: number;
}

const PRIORIDAD_COLOR: Record<string, string> = {
  baja: "#FFB51C", normal: "#43A847", alta: "#5750E8", urgente: "#E53935"
};

export default function TareasChatPage() {
  const router = useRouter();
  const [list, setList] = useState<ChatRow[] | null>(null);

  const load = async () => {
    const r = await fetch("/api/tareas/chat/bandeja");
    const d = await r.json();
    setList(d.chats || []);
  };

  useEffect(() => { load(); }, []);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-3">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            Conversaciones
          </div>
          <h1 className="font-display text-3xl sm:text-5xl font-black leading-tight tracking-tight">
            <span className="text-gradient-orange">Chat</span> de tareas
          </h1>
          <p className="mt-3 text-neutral-500 text-[15px]">
            Comentarios, avisos y super-notificaciones de todas las tareas donde participas.
          </p>
        </motion.div>

        <div className="space-y-2">
          {list === null ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 h-20 skeleton border border-neutral-100" />
            ))
          ) : list.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 text-center border border-neutral-100">
              <MessageSquareMore className="h-12 w-12 text-brand-orange mx-auto mb-4" strokeWidth={1.5} />
              <h3 className="font-display text-2xl font-black mb-1.5">Bandeja vacía</h3>
              <p className="text-neutral-500 text-sm">Cuando haya conversaciones en tus tareas aparecerán aquí.</p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {list.map((r, i) => (
                <motion.button
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(0.03 * i, 0.3) }}
                  whileHover={{ y: -2 }}
                  onClick={() => router.push(`/tareas?id=${r.tarea_id}`)}
                  className="w-full bg-white rounded-2xl px-5 py-4 flex items-center gap-4 text-left border border-neutral-100 hover:shadow-lg hover:shadow-black/5 transition-all"
                >
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-white"
                    style={{ backgroundColor: PRIORIDAD_COLOR[r.prioridad] || "#5C6670" }}
                  >
                    <MessageSquareMore className="h-5 w-5" strokeWidth={2} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-display font-bold text-sm truncate flex-1">{r.tarea_titulo}</div>
                      {r.ultimo_mensaje_at && (
                        <span className="text-[10px] text-neutral-400 font-ui shrink-0">
                          {new Date(r.ultimo_mensaje_at).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-neutral-500 truncate mt-0.5">{r.ultimo_mensaje || "Sin mensajes"}</div>
                  </div>

                  {r.unread_count > 0 && (
                    <motion.span
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                      className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-brand-red text-white text-[10px] font-bold flex items-center justify-center"
                    >
                      {r.unread_count}
                    </motion.span>
                  )}

                  {r.tarea_estado === "completada" && (
                    <span className="shrink-0 text-[9px] font-ui font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Completada
                    </span>
                  )}
                </motion.button>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </AppShell>
  );
}
