"use client";
import { useState } from "react";
import { UserCircle, Check, CaretDown } from "@/lib/bootstrap-icons";
import { WhatsAppAvatar } from "./WhatsAppAvatar";

export interface UsuarioAsignable {
  id: string;
  nombre: string;
  foto_perfil_url: string | null;
}

interface Props {
  usuarios: UsuarioAsignable[];
  valor: string | null;
  onChange: (userId: string | null) => void;
}

/** Selector de agente asignado — mismo patrón visual que `TagPicker`/`StagePicker` de
 * `ConversationThread.tsx`. `asignado_a` sigue siendo una referencia simple a `gozz.users.id`
 * (sin tabla ni tipo de dato paralelo para "agentes"), a propósito: cuando exista la integración
 * con n8n, un agente de IA será una fila más de `gozz.users` y este selector funcionará igual. */
export function AsignadoPicker({ usuarios, valor, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const actual = usuarios.find((u) => u.id === valor);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={actual ? `Asignada a ${actual.nombre}` : "Sin asignar"}
        className="h-8 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-1 transition"
      >
        {actual ? (
          <WhatsAppAvatar fotoUrl={actual.foto_perfil_url} nombre={actual.nombre} size={20} />
        ) : (
          <UserCircle className="h-4.5 w-4.5 text-neutral-400" />
        )}
        <CaretDown className="h-3 w-3 shrink-0 text-neutral-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-56 max-w-[calc(100vw-2rem)] max-h-64 overflow-y-auto rounded-xl glass-panel py-1">
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
            >
              <UserCircle className="h-4 w-4 text-neutral-400 shrink-0" />
              <span className="flex-1">Sin asignar</span>
              {!valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
            </button>
            {usuarios.map((u) => (
              <button
                key={u.id}
                onClick={() => { onChange(u.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition"
              >
                <WhatsAppAvatar fotoUrl={u.foto_perfil_url} nombre={u.nombre} size={20} />
                <span className="flex-1 truncate">{u.nombre}</span>
                {u.id === valor && <Check className="h-3.5 w-3.5 text-brand-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
