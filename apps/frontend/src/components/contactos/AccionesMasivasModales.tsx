"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckSquare, UserCog, X } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============================================================================================
// ACCIONES MASIVAS · OLA 3 · ETAPA 2 — cambiar responsable y agregar tarea
//
// Las dos llevaban meses en el desplegable con "— próximamente".
//
// 🔴 LO QUE NO PUEDE FALTAR EN NINGUNA DE LAS DOS: el número de contactos afectados DELANTE DE LOS
// OJOS antes de pulsar. Con "seleccionar el total" pueden ser miles, y una acción masiva que no
// dice sobre cuántos actúa es una trampa. Va en el título del diálogo y en el botón.
// ============================================================================================

interface Usuario { id: string; nombre: string; activo?: boolean }

interface BaseProps {
  abierto: boolean;
  /** El contrato de selección que entienden todas las acciones masivas. */
  seleccion: any;
  /** Cuántos contactos afecta. Es el número que el usuario tiene que ver antes de confirmar. */
  cuantos: number;
  onCerrar: () => void;
  onHecho: () => void;
}

/** Los usuarios ACTIVOS: a un usuario dado de baja el backend no le asigna nada (400). */
function useUsuariosActivos(abierto: boolean) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  useEffect(() => {
    if (!abierto) return;
    let cancelado = false;
    fetch("/api/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => { if (!cancelado) setUsuarios((d.users || []).filter((u: Usuario) => u.activo !== false)); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [abierto]);
  return usuarios;
}

const overlay = "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8";
const tarjeta = "relative w-full max-w-lg bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col";
const campo = "w-full h-10 px-3 rounded-xl bg-neutral-100 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-orange/40";

// --------------------------------------------------------------------------------------------
// A · Cambiar responsable
// --------------------------------------------------------------------------------------------
export function AsignarResponsableModal({ abierto, seleccion, cuantos, onCerrar, onHecho }: BaseProps) {
  const usuarios = useUsuariosActivos(abierto);
  // "" = nadie elegido todavía · "__ninguno__" = quitar el responsable (null explícito).
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (abierto) setValor(""); }, [abierto]);
  if (!abierto) return null;

  const quitar = valor === "__ninguno__";
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await fetch("/api/contactos/responsable", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // 🔴 `null` EXPLÍCITO para quitar. El backend rechaza el campo ausente a propósito: un
        // `undefined` no puede acabar dejando sin responsable a cientos de contactos.
        body: JSON.stringify({ seleccion, responsableId: quitar ? null : valor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.mensaje || d?.error || `HTTP ${r.status}`);
      toast.success(
        d.cambiados === 0
          ? "No hubo cambios: ya tenían ese responsable"
          : `${d.cambiados} contacto${d.cambiados === 1 ? "" : "s"} ${quitar ? "sin responsable" : "reasignado" + (d.cambiados === 1 ? "" : "s")}`
      );
      onHecho();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo cambiar el responsable");
    } finally { setEnviando(false); }
  };

  return (
    <div className={overlay} onClick={onCerrar}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={tarjeta} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center">
            <UserCog className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-black">Cambiar responsable</h2>
            {/* El número, delante. */}
            <p className="text-[11px] text-neutral-500">
              Afecta a <span className="font-bold text-brand-orange tabular-nums">{cuantos}</span> contacto{cuantos === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={onCerrar} className="h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center">
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Nuevo responsable</label>
          <select value={valor} onChange={(e) => setValor(e.target.value)} className={campo}>
            <option value="">Selecciona…</option>
            <option value="__ninguno__">— Sin responsable (quitar el actual) —</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>

          {quitar && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800 dark:text-amber-300">
                Vas a dejar <strong>{cuantos}</strong> contacto{cuantos === 1 ? "" : "s"} <strong>sin responsable</strong>.
              </p>
            </div>
          )}
          <p className="text-[11px] text-neutral-500">
            Queda registrado en la auditoría con el responsable anterior de cada contacto, así que se
            puede revisar y deshacer.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 flex items-center justify-end gap-2">
          <button onClick={onCerrar} className="h-10 px-4 rounded-xl text-sm font-bold text-neutral-500 hover:text-neutral-800">Cancelar</button>
          <button
            onClick={enviar}
            disabled={!valor || enviando}
            className="h-10 px-4 rounded-xl bg-brand-orange text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enviando ? "Aplicando…" : `Aplicar a ${cuantos} contacto${cuantos === 1 ? "" : "s"}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------
// B · Agregar tarea (una por contacto)
// --------------------------------------------------------------------------------------------
export function AgregarTareaMasivaModal({ abierto, seleccion, cuantos, onCerrar, onHecho }: BaseProps) {
  const usuarios = useUsuariosActivos(abierto);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [responsable, setResponsable] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [fechaLimite, setFechaLimite] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (abierto) { setTitulo(""); setDescripcion(""); setResponsable(""); setPrioridad("normal"); setFechaLimite(""); }
  }, [abierto]);
  if (!abierto) return null;

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await fetch("/api/contactos/tareas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seleccion,
          tarea: {
            titulo: titulo.trim(),
            descripcion: descripcion.trim() || null,
            responsable_id: responsable || null,
            prioridad,
            fecha_limite: fechaLimite ? new Date(fechaLimite).toISOString() : null,
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.mensaje || (typeof d?.error === "string" ? d.error : null) || `HTTP ${r.status}`);
      toast.success(`${d.creadas} tarea${d.creadas === 1 ? "" : "s"} creada${d.creadas === 1 ? "" : "s"}`);
      onHecho();
    } catch (e: any) {
      toast.error(e?.message || "No se pudieron crear las tareas");
    } finally { setEnviando(false); }
  };

  return (
    <div className={overlay} onClick={onCerrar}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={tarjeta} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center">
            <CheckSquare className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <h2 className="font-display text-lg font-black">Agregar tarea</h2>
            <p className="text-[11px] text-neutral-500">
              Sobre <span className="font-bold text-brand-orange tabular-nums">{cuantos}</span> contacto{cuantos === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={onCerrar} className="h-9 w-9 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/5 flex items-center justify-center">
            <X className="h-4 w-4 text-neutral-500" />
          </button>
        </div>

        {/* 🔴 Con todas las letras. La gente espera "una tarea para todos"; el esquema no lo permite
            —`tareas.contacto_id` es escalar, no hay tabla puente— y hay que decirlo AQUÍ, no dejar
            que lo descubran cuando les aparezcan 3.806 tareas en su lista. */}
        <div className="mx-5 mt-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[12px] text-amber-800 dark:text-amber-300">
            Se creará <strong>una tarea por cada contacto</strong>: en total{" "}
            <strong className="tabular-nums">{cuantos}</strong> tarea{cuantos === 1 ? "" : "s"}, cada una
            ligada a su ficha. No es una sola tarea compartida.
          </p>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Título</label>
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Confirmar documentación pendiente" className={campo} />
          </div>
          <div>
            <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Descripción (opcional)</label>
            <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-orange/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Responsable</label>
              <select value={responsable} onChange={(e) => setResponsable(e.target.value)} className={campo}>
                <option value="">Yo</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Prioridad</label>
              <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)} className={campo}>
                {["baja", "normal", "alta", "urgente"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 mb-1">Fecha límite (opcional)</label>
            <input type="date" value={fechaLimite} onChange={(e) => setFechaLimite(e.target.value)} className={campo} />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-black/5 dark:border-white/5 flex items-center justify-end gap-2">
          <button onClick={onCerrar} className="h-10 px-4 rounded-xl text-sm font-bold text-neutral-500 hover:text-neutral-800">Cancelar</button>
          <button
            onClick={enviar}
            disabled={titulo.trim().length < 2 || enviando}
            className={cn("h-10 px-4 rounded-xl bg-brand-orange text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed")}
          >
            {enviando ? "Creando…" : `Crear ${cuantos} tarea${cuantos === 1 ? "" : "s"}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
