"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { useCall } from "@/components/videollamada/CallProvider";

// La pagina de llamada ya NO renderiza la sala: solo valida acceso y le pide al
// CallProvider (global, persistente) que muestre la llamada a pantalla completa.
// Asi la conexion sobrevive cuando el usuario pulsa "Ver CRM" y navega por el CRM.
export default function VideollamadaPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { enter } = useCall();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meR, roomR] = await Promise.all([
          fetch("/api/auth/me"),
          fetch(`/api/videollamadas/${id}`),
        ]);
        const me = await meR.json();
        const room = await roomR.json();
        if (!meR.ok || !me?.user) throw new Error("Sesión inválida (HTTP " + meR.status + ")");
        if (!roomR.ok || !room.videollamada) throw new Error("Sala no encontrada (HTTP " + roomR.status + ")");

        const v = room.videollamada;
        if (v.fin) throw new Error("Esta llamada ya terminó");

        const selfUserId = me.user.id;
        const participantes: string[] = Array.isArray(v.participantes) ? v.participantes : [];
        const isMember = selfUserId === v.iniciada_por || participantes.includes(selfUserId);
        if (!isMember) {
          const j = await fetch(`/api/videollamadas/${id}/join`, { method: "POST" });
          if (!j.ok) throw new Error("No autorizado en esta sala (HTTP " + j.status + ")");
        }

        if (cancelled) return;
        enter(id, { title: v.nombre_sala || "Videollamada" });
      } catch (e: any) {
        if (cancelled) return;
        setError(e.message);
        toast.error(e.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="fixed inset-0 z-[90] bg-neutral-950 text-white flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-brand-red font-display font-black text-xl mb-2">Error</div>
          <div className="text-neutral-400 text-sm mb-6">{error}</div>
          <button onClick={() => router.push("/chat")} className="h-10 px-5 rounded-xl bg-gradient-to-r from-brand-orange to-neon-magenta text-white text-sm font-bold uppercase tracking-wider">Volver al chat</button>
        </div>
      </div>
    );
  }

  // Placeholder mientras el provider obtiene el token y conecta (luego su overlay cubre esto).
  return (
    <div className="fixed inset-0 z-[90] bg-neutral-950 text-white flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-brand-orange" />
        <div className="text-sm text-neutral-400">Conectando a la sala...</div>
      </div>
    </div>
  );
}
