"use client";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { X, WhatsappLogo } from "@/lib/bootstrap-icons";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import type { WhatsAppConexion } from "./types";

interface Props {
  conexiones: WhatsAppConexion[];
  onClose: () => void;
  onElegir: (conexion: WhatsAppConexion) => void;
}

/** Solo aparece cuando hay más de un número de WhatsApp conectado — con uno solo se usa directo,
 * sin pedirle nada al usuario. */
export function ElegirConexionWhatsAppModal({ conexiones, onClose, onElegir }: Props) {
  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-sm glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 font-display font-black text-sm">¿Con cuál número escribes?</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-2">
        {conexiones.map((c) => {
          const { texto, bandera } = c.telefono ? formatearNumeroWhatsApp(c.telefono) : { texto: "", bandera: null };
          return (
            <button
              key={c.id}
              onClick={() => onElegir(c)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.03] text-left transition"
            >
              <div className="h-10 w-10 rounded-full bg-brand-green/15 text-brand-green flex items-center justify-center shrink-0">
                <WhatsappLogo className="h-4.5 w-4.5" weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{c.nombre}</div>
                <div className="text-[11px] text-neutral-500 truncate">{bandera ? `${bandera} ` : ""}{texto}</div>
              </div>
            </button>
          );
        })}
      </div>
    </AnimatedModal>
  );
}
