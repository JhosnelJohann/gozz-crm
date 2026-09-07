"use client";
import Link from "next/link";
import { AnimatedModal } from "@/components/ui/AnimatedModal";
import { Button } from "@/components/ui/Button";
import { X, Link2, Briefcase, CheckCircle2 } from "@/lib/bootstrap-icons";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { formatearNumeroWhatsApp } from "@/lib/whatsapp-numero";
import type { WhatsAppConversacionDetalle } from "./types";

interface Props {
  conversacion: WhatsAppConversacionDetalle;
  onClose: () => void;
  onVincular: () => void;
  onConvertir: () => void;
}

const VINCULO_LABEL: Record<WhatsAppConversacionDetalle["contacto_vinculo_estado"], string> = {
  sin_vincular: "Sin vincular a un contacto",
  vinculado_auto: "Vinculado automáticamente por teléfono",
  vinculado_manual: "Vinculado a un contacto",
};

export function PerfilConversacionModal({ conversacion, onClose, onVincular, onConvertir }: Props) {
  const nombre = conversacion.nombre_whatsapp || conversacion.wa_jid.split("@")[0];
  const { texto: numero, bandera } = formatearNumeroWhatsApp(conversacion.wa_jid);
  return (
    <AnimatedModal onClose={onClose} panelClassName="w-full max-w-sm glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 font-display font-black text-sm">Perfil de la conversación</div>
        <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-6 flex flex-col items-center text-center gap-1">
        <WhatsAppAvatar fotoUrl={conversacion.foto_perfil_url} nombre={nombre} size={88} className="text-2xl" />
        <div className="mt-3 text-lg font-display font-black">{nombre}</div>
        <div className="text-sm text-neutral-500">{bandera ? `${bandera} ` : ""}{numero}</div>
        <div className={`mt-1 text-[11px] font-ui font-bold uppercase tracking-wider ${conversacion.contacto_id ? "text-brand-green" : "text-neutral-400"}`}>
          {VINCULO_LABEL[conversacion.contacto_vinculo_estado]}
        </div>

        <div className="w-full space-y-2 pt-5">
          {conversacion.contacto_id ? (
            <>
              <Link href={`/contactos/${conversacion.contacto_id}`}>
                <Button variant="secondary" className="w-full">Ver contacto en el CRM</Button>
              </Link>
              {conversacion.oportunidad_id ? (
                <div className="h-10 rounded-xl bg-brand-green/10 text-brand-green flex items-center justify-center gap-2 text-sm font-bold">
                  <CheckCircle2 className="h-4 w-4" weight="fill" /> Ya convertida a Oportunidad
                </div>
              ) : (
                <Button onClick={onConvertir} className="w-full">
                  <Briefcase className="h-4 w-4" /> Convertir a Oportunidad
                </Button>
              )}
            </>
          ) : (
            <Button onClick={onVincular} className="w-full">
              <Link2 className="h-4 w-4" /> Vincular o crear contacto
            </Button>
          )}
        </div>
      </div>
    </AnimatedModal>
  );
}
