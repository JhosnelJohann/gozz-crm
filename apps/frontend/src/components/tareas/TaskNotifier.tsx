"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckSquare, Bell } from "@/lib/bootstrap-icons";
import { getSocket } from "@/lib/socket";
import { playMessagePing } from "@/lib/ringtone";

interface NotifEvent {
  tipo: string;
  tarea_id?: string;
  titulo?: string;
}

export function TaskNotifier() {
  const router = useRouter();

  useEffect(() => {
    const s = getSocket();
    const onNotif = (ev: NotifEvent) => {
      if (!ev?.tipo || !ev.tipo.startsWith("tarea_")) return;
      try { playMessagePing(); } catch {}

      const label = ev.tipo === "tarea_asignada" ? "Nueva tarea asignada" :
                    ev.tipo === "tarea_mencion" ? "Te mencionaron" :
                    ev.tipo === "tarea_mensaje" ? "Mensaje nuevo en tarea" :
                    "Actualización de tarea";

      toast.custom((id) => (
        <button
          onClick={() => {
            toast.dismiss(id);
            if (ev.tarea_id) router.push(`/tareas?id=${ev.tarea_id}`);
          }}
          className="bg-white w-[340px] max-w-[86vw] rounded-2xl p-3 flex items-center gap-3 text-left shadow-xl border border-neutral-100 hover:border-brand-orange/60 transition"
        >
          <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
            <CheckSquare className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{label}</div>
            {ev.titulo && <div className="text-xs text-neutral-500 truncate">{ev.titulo}</div>}
          </div>
          <Bell className="h-3.5 w-3.5 text-neutral-300 shrink-0" strokeWidth={2} />
        </button>
      ), { duration: 4500 });
    };

    s.on("notificacion:nueva", onNotif);
    return () => { s.off("notificacion:nueva", onNotif); };
  }, [router]);

  return null;
}
