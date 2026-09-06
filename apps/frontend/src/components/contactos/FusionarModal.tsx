"use client";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, ArrowRight, Briefcase, CheckSquare, ChevronDown, ChevronRight, FileText, Folder, GitMerge, Lock, Mail, MessageSquare, X } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

// ============================================================================================
// MODAL COMPARATIVO DE FUSIÓN — la pieza central de la Ola 2.
//
// Es una HERRAMIENTA DE AUDITORÍA MANUAL: el humano arma el "contacto ideal" tomando cada campo
// del contacto que prefiera, aunque los dos lo tengan lleno.
//
// ⚠️ LOS DOS PLANOS DE UNA FUSIÓN, que esta pantalla NO debe confundir:
//   · RELACIONAL (oportunidades, tareas, documentos, notas, carpetas): NO SE ELIGE NADA. Todo
//     pasa al maestro, siempre. Por eso los contadores de cada columna son INFORMATIVOS y llevan
//     al lado la frase de que nada se descarta. Si el usuario llega a pensar que puede "quedarse
//     con los archivos de uno de los dos", la pantalla está mal hecha.
//   · ESCALAR (nombre, teléfono, email…): aquí y solo aquí hay radios.
// ============================================================================================

interface Props {
  abierto: boolean;
  idA: string | null;
  idB: string | null;
  onCancelar: () => void;
  onFusionado: () => void;
}

interface Preview {
  contactos: any[];
  impacto: any[];
  elegibles: string[];
  no_elegibles: Record<string, string>;
  maestro_sugerido: string;
  maestro_motivo: string;
  posible_familia: boolean;
  // D5 — señal graduada. Opcionales: si la API es más vieja que este build, se cae a
  // `posible_familia` y el modal sigue funcionando.
  parecido_nivel?: "probable_duplicado" | "dudoso" | "probable_familia";
  parecido_similitud?: number;
  parecido_motivo?: string;
}

const ETIQUETAS: Record<string, string> = {
  nombre_completo: "Nombre completo", email: "Email", telefono: "Teléfono", whatsapp: "WhatsApp",
  a_number: "A-Number", fecha_nacimiento: "Fecha de nacimiento", ssn_encrypted: "SSN",
  pasaporte_numero: "Pasaporte nº", pasaporte_pais: "País del pasaporte", pasaporte_expira: "Pasaporte expira",
  estatus_migratorio: "Estatus migratorio", estatus_migratorio_tipo: "Tipo de estatus",
  estatus_migratorio_otros: "Estatus (otros)", direccion_calle: "Calle", direccion_linea2: "Línea 2",
  direccion_ciudad: "Ciudad", direccion_estado: "Estado", direccion_cp: "Código postal",
  direccion_pais: "País", correo_uscis: "Correo USCIS", usuario_uscis: "Usuario USCIS",
  clave_uscis_enc: "Clave USCIS", clave_correo_uscis_enc: "Clave del correo USCIS",
  id: "ID interno", created_at: "Fecha de creación",
};
const eti = (c: string) => ETIQUETAS[c] || c.replace(/_/g, " ");

const mostrar = (v: any) => {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const norm = (s: any) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function FusionarModal({ abierto, idA, idB, onCancelar, onFusionado }: Props) {
  const [data, setData] = useState<Preview | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maestroId, setMaestroId] = useState<string | null>(null);
  const [elegido, setElegido] = useState<Record<string, string>>({});   // campo → contactoIdDeOrigen
  const [verTodos, setVerTodos] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!abierto || !idA || !idB) { setData(null); setError(null); setConfirmando(false); return; }
    let cancelado = false;
    setCargando(true); setError(null); setData(null);
    (async () => {
      try {
        const r = await fetch(`/api/contactos/fusion/preview?a=${idA}&b=${idB}`);
        const d = await r.json().catch(() => ({}));
        if (cancelado) return;
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
        setData(d);
        setMaestroId(d.maestro_sugerido);
        setElegido({});
      } catch (e: any) {
        if (!cancelado) setError(e?.message || "No se pudo cargar la comparación");
      } finally { if (!cancelado) setCargando(false); }
    })();
    return () => { cancelado = true; };
  }, [abierto, idA, idB]);

  const maestro = data?.contactos.find((c) => c.id === maestroId) || null;
  const otro = data?.contactos.find((c) => c.id !== maestroId) || null;
  const impactoDe = (id: string) => data?.impacto.find((i) => i.id === id);

  /** De qué contacto sale cada campo. Sin elección explícita: el maestro, salvo que lo tenga
   *  vacío y el otro lleno — así no se pierde un dato por inercia. */
  const origenDe = (campo: string): string => {
    if (elegido[campo]) return elegido[campo];
    if (!maestro || !otro) return maestroId || "";
    if (mostrar(maestro[campo]) === null && mostrar(otro[campo]) !== null) return otro.id;
    return maestro.id;
  };
  const valorFinal = (campo: string) => {
    const src = origenDe(campo) === maestro?.id ? maestro : otro;
    return src ? src[campo] : null;
  };

  const filas = useMemo(() => {
    if (!data || !maestro || !otro) return { difieren: [] as string[], iguales: [] as string[] };
    const difieren: string[] = [], iguales: string[] = [];
    for (const c of data.elegibles) {
      const a = mostrar(maestro[c]), b = mostrar(otro[c]);
      if (a === null && b === null) { iguales.push(c); continue; }
      (norm(a) === norm(b) ? iguales : difieren).push(c);
    }
    return { difieren, iguales };
  }, [data, maestro, otro]);

  // Cuántos valores del maestro se van a REEMPLAZAR por los del otro. Es legítimo, pero no puede
  // pasar inadvertido.
  const pisados = useMemo(() => {
    if (!maestro || !otro) return [] as string[];
    return (data?.elegibles || []).filter((c) => {
      const src = origenDe(c);
      return src !== maestro.id && mostrar(maestro[c]) !== null && norm(mostrar(maestro[c])) !== norm(mostrar(otro[c]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, maestro, otro, elegido]);

  const totalTras = useMemo(() => {
    const a = impactoDe(idA || ""), b = impactoDe(idB || "");
    const s = (k: string) => (Number((a as any)?.[k]) || 0) + (Number((b as any)?.[k]) || 0);
    return { oportunidades: s("oportunidades"), tareas: s("tareas"), documentos: s("documentos"), notas: s("notas") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, idA, idB]);

  const fusionar = async () => {
    if (!maestro || !otro) return;
    setFusionando(true);
    try {
      // Solo se mandan los campos donde el origen NO es el maestro: para el resto no hay nada que
      // cambiar. Y se manda el ID DE ORIGEN, nunca el valor — el servidor lo lee de la fila.
      const valoresElegidos: Record<string, string> = {};
      for (const c of data?.elegibles || []) {
        const src = origenDe(c);
        if (src !== maestro.id) valoresElegidos[c] = src;
      }
      const r = await fetch("/api/contactos/fusionar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maestroId: maestro.id, perdedorId: otro.id, valoresElegidos }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo fusionar");
      onFusionado();
    } catch (e: any) {
      setError(e?.message || "No se pudo fusionar");
      setConfirmando(false);
    } finally { setFusionando(false); }
  };

  const Celda = ({ campo, c }: { campo: string; c: any }) => {
    const v = mostrar(c[campo]);
    const seleccionado = origenDe(campo) === c.id;
    return (
      <td className={cn("px-3 py-2 align-top", seleccionado && "bg-brand-orange/5")}>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name={`campo-${campo}`}
            checked={seleccionado}
            onChange={() => setElegido((p) => ({ ...p, [campo]: c.id }))}
            className="mt-0.5 h-3.5 w-3.5 accent-[#5750E8] shrink-0 cursor-pointer"
          />
          <span className={cn("text-[13px] break-all", v === null ? "text-neutral-300 italic" : "text-neutral-800 dark:text-neutral-100")}>
            {v ?? "vacío"}
          </span>
        </label>
      </td>
    );
  };

  const Contadores = ({ id }: { id: string }) => {
    const i = impactoDe(id);
    if (!i) return null;
    const items = [
      { icono: Briefcase, n: i.oportunidades, t: "oportunidades" },
      { icono: CheckSquare, n: i.tareas, t: "tareas" },
      { icono: FileText, n: i.documentos, t: "documentos" },
      { icono: Folder, n: i.carpetas_drive, t: "carpetas" },
      { icono: MessageSquare, n: i.notas, t: "notas" },
      { icono: Mail, n: i.emails, t: "correos" },
    ];
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {items.map(({ icono: I, n, t }) => (
          <span key={t} className={cn("inline-flex items-center gap-1 text-[11px]", n > 0 ? "text-neutral-600 dark:text-neutral-300" : "text-neutral-300")}>
            <I className="h-3 w-3" strokeWidth={1.6} /> <span className="tabular-nums font-semibold">{n}</span> {t}
          </span>
        ))}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {abierto && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={onCancelar}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-neutral-900 rounded-3xl my-8 max-w-5xl w-full shadow-2xl border border-black/5 dark:border-white/10 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-4 px-7 py-5 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-brand-orange/10 flex items-center justify-center">
                  <GitMerge className="h-5 w-5 text-brand-orange" strokeWidth={1.8} />
                </div>
                <div>
                  <h2 className="font-display text-xl font-black leading-tight">Fusionar contactos</h2>
                  <p className="text-[12px] text-neutral-500">Arma la ficha final tomando cada dato del contacto que prefieras.</p>
                </div>
              </div>
              <button onClick={onCancelar} className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center shrink-0">
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-7 py-5 max-h-[70vh] overflow-y-auto">
              {cargando && <div className="space-y-2"><div className="h-5 w-64 skeleton rounded" /><div className="h-5 w-48 skeleton rounded" /><div className="h-40 w-full skeleton rounded-xl" /></div>}

              {error && (
                <div className="rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 p-4 mb-4">
                  <p className="text-sm text-red-700 font-semibold">{error}</p>
                </div>
              )}

              {data && maestro && otro && !confirmando && (
                <>
                  {/* ⚠️ Señal de FAMILIA (D5). No es cosmética: en los casos de asilo varios
                      familiares comparten el teléfono del titular, y fusionarlos destruye el
                      expediente de un dependiente.

                      Antes este aviso salía SIEMPRE —la señal era igualdad exacta del nombre, y dos
                      duplicados reales casi nunca están escritos igual—, así que quien auditaba
                      aprendía a ignorarlo y el día que fuera una familia de verdad lo saltaba igual.
                      Ahora el aviso FUERTE se reserva a `probable_familia`; `dudoso` lleva una nota
                      sobria y `probable_duplicado` no interrumpe. */}
                  {(data.parecido_nivel ?? (data.posible_familia ? "probable_familia" : "probable_duplicado")) === "probable_familia" && (
                    <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border-2 border-amber-300 p-4 mb-5 flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" strokeWidth={2} />
                      <div>
                        <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Esto parece una FAMILIA, no un duplicado</p>
                        <p className="text-[13px] text-amber-800 dark:text-amber-300 mt-1">
                          {data.parecido_motivo ??
                            "Estos contactos comparten teléfono o email pero tienen nombres distintos."}
                        </p>
                        <p className="text-[13px] text-amber-900 dark:text-amber-200 mt-2 font-semibold">
                          Si son dos personas, fusionarlas <strong>destruye el expediente del dependiente</strong>:
                          sus oportunidades, tareas, notas y documentos pasan a la ficha del otro y su ficha queda
                          archivada. Compruébalo antes de continuar.
                        </p>
                      </div>
                    </div>
                  )}

                  {data.parecido_nivel === "dudoso" && (
                    <div className="rounded-2xl bg-neutral-50 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3 mb-5 flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-neutral-500 shrink-0 mt-0.5" strokeWidth={2} />
                      <p className="text-[13px] text-neutral-700 dark:text-neutral-300">
                        {data.parecido_motivo ?? "La señal no es concluyente: compruébalo a mano antes de fusionar."}
                      </p>
                    </div>
                  )}

                  <div className="rounded-2xl bg-neutral-50 dark:bg-white/5 border border-black/5 p-4 mb-5">
                    <p className="text-[13px] text-neutral-700 dark:text-neutral-200 font-semibold mb-1">
                      Todo lo de las columnas se conserva y pasa al maestro.
                    </p>
                    <p className="text-[12px] text-neutral-500">
                      No se descarta ningún archivo, oportunidad ni tarea. Los contadores de abajo son informativos:
                      no hay nada que elegir ahí. Lo único que se elige son los datos de la ficha.
                    </p>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 border-black/10">
                        <th className="text-left px-3 py-3 w-[22%] text-[11px] font-ui uppercase tracking-wider text-neutral-400">Campo</th>
                        {[maestro, otro].map((c) => (
                          <th key={c.id} className="text-left px-3 py-3 w-[26%] align-top">
                            <label className="flex items-start gap-2 cursor-pointer">
                              <input type="radio" name="maestro" checked={maestroId === c.id}
                                onChange={() => { setMaestroId(c.id); setElegido({}); }}
                                className="mt-1 h-4 w-4 accent-[#5750E8] shrink-0 cursor-pointer" />
                              <span>
                                <span className="block font-display font-black text-[15px] leading-tight">{c.nombre_completo || "Sin nombre"}</span>
                                <span className={cn("inline-block mt-0.5 text-[10px] font-ui font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                                  maestroId === c.id ? "bg-brand-orange text-white" : "bg-neutral-100 text-neutral-500")}>
                                  {maestroId === c.id ? "Maestro" : "Se archivará"}
                                </span>
                                <Contadores id={c.id} />
                              </span>
                            </label>
                          </th>
                        ))}
                        <th className="text-left px-3 py-3 w-[26%] text-[11px] font-ui uppercase tracking-wider text-brand-orange align-top">
                          Resultado
                          <span className="block font-normal normal-case tracking-normal text-[11px] text-neutral-400 mt-1">Cómo quedará la ficha</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-brand-orange/5">
                        <td colSpan={4} className="px-3 py-2 text-[12px] text-neutral-600 dark:text-neutral-300">
                          El contacto <strong>maestro conserva su ficha e historial</strong>; el otro queda archivado apuntando a él.
                          Se sugiere <strong>{maestro.nombre_completo}</strong> porque {data.maestro_motivo}.
                        </td>
                      </tr>

                      {filas.difieren.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-4 text-[13px] text-neutral-500">Los dos contactos tienen exactamente los mismos datos. No hay nada que decidir.</td></tr>
                      )}

                      {filas.difieren.map((campo) => {
                        const pisa = pisados.includes(campo);
                        return (
                          <tr key={campo} className="border-b border-black/5">
                            <td className="px-3 py-2 text-[12px] font-semibold text-neutral-600 dark:text-neutral-300 align-top">
                              {eti(campo)}
                              {pisa && <span title="Reemplaza un valor del maestro" className="ml-1 text-amber-600">⚠</span>}
                            </td>
                            <Celda campo={campo} c={maestro} />
                            <Celda campo={campo} c={otro} />
                            <td className={cn("px-3 py-2 align-top text-[13px] break-all", pisa ? "bg-amber-50 dark:bg-amber-500/10" : "bg-brand-orange/[0.03]")}>
                              {mostrar(valorFinal(campo)) ?? <span className="text-neutral-300 italic">vacío</span>}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Idénticas, vacías y no elegibles: colapsadas por defecto. Con ~40 columnas,
                          un modal que las muestre todas planas es inusable. */}
                      <tr>
                        <td colSpan={4} className="px-3 py-3">
                          <button onClick={() => setVerTodos((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-800">
                            {verTodos ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            Ver todos los campos ({filas.iguales.length + Object.keys(data.no_elegibles).length} sin decisión)
                          </button>
                        </td>
                      </tr>

                      {verTodos && filas.iguales.map((campo) => (
                        <tr key={campo} className="border-b border-black/5 opacity-70">
                          <td className="px-3 py-2 text-[12px] text-neutral-500 align-top">{eti(campo)}</td>
                          <Celda campo={campo} c={maestro} />
                          <Celda campo={campo} c={otro} />
                          <td className="px-3 py-2 text-[13px] break-all bg-brand-orange/[0.03]">{mostrar(valorFinal(campo)) ?? <span className="text-neutral-300 italic">vacío</span>}</td>
                        </tr>
                      ))}

                      {verTodos && Object.entries(data.no_elegibles).map(([campo, motivo]) => (
                        <tr key={campo} className="border-b border-black/5 bg-neutral-50/60 dark:bg-white/[0.02]">
                          <td className="px-3 py-2 text-[12px] text-neutral-400 align-top" title={motivo}>
                            <Lock className="inline h-3 w-3 mr-1" strokeWidth={1.6} />{eti(campo)}
                          </td>
                          <td className="px-3 py-2 text-[13px] text-neutral-400 break-all align-top" title={motivo}>{mostrar(maestro[campo]) ?? "—"}</td>
                          <td className="px-3 py-2 text-[13px] text-neutral-400 break-all align-top" title={motivo}>{mostrar(otro[campo]) ?? "—"}</td>
                          <td className="px-3 py-2 text-[12px] text-neutral-400 align-top" title={motivo}>No se puede elegir</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="text-[12px] text-neutral-500 mt-4">
                    ¿Necesitas un valor que no está en ninguno de los dos? Eso no es una fusión: fusiona primero y
                    luego edita el contacto por el formulario normal.
                  </p>
                </>
              )}

              {/* ---- Confirmación con los números ---- */}
              {data && maestro && otro && confirmando && (
                <div className="py-2">
                  <h3 className="font-display text-lg font-black mb-4">Esto es lo que va a pasar</h3>
                  <div className="rounded-2xl border border-black/5 divide-y divide-black/5 mb-4">
                    <div className="px-4 py-3 flex items-center gap-2 text-sm">
                      <span className="text-neutral-500">Quedará 1 contacto:</span>
                      <strong>{mostrar(valorFinal("nombre_completo")) || maestro.nombre_completo}</strong>
                    </div>
                    <div className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-200">
                      Con <strong className="tabular-nums">{totalTras.oportunidades}</strong> oportunidades,{" "}
                      <strong className="tabular-nums">{totalTras.documentos}</strong> documentos,{" "}
                      <strong className="tabular-nums">{totalTras.tareas}</strong> tareas y{" "}
                      <strong className="tabular-nums">{totalTras.notas}</strong> notas — la suma de los dos.
                    </div>
                    <div className="px-4 py-3 text-sm flex items-center gap-2">
                      <span className="text-neutral-500">Se archivará:</span>
                      <strong>{otro.nombre_completo || "Sin nombre"}</strong>
                      <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
                      <span className="text-[12px] text-neutral-500">apuntando al maestro</span>
                    </div>
                    {pisados.length > 0 && (
                      <div className="px-4 py-3 text-sm bg-amber-50 dark:bg-amber-500/10">
                        <strong className="text-amber-800 dark:text-amber-300">Vas a reemplazar {pisados.length} valor{pisados.length === 1 ? "" : "es"} del maestro:</strong>{" "}
                        <span className="text-[13px] text-amber-800 dark:text-amber-300">{pisados.map(eti).join(", ")}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[12px] text-neutral-500">
                    <strong>Es reversible.</strong> Nada se borra: el contacto archivado sigue en la base y la fusión
                    se puede deshacer entera.
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-7 py-5 border-t border-black/5">
              <button
                onClick={() => (confirmando ? setConfirmando(false) : onCancelar())}
                disabled={fusionando}
                className="flex-1 h-11 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-white font-ui text-xs font-bold uppercase tracking-wider hover:bg-neutral-200 transition disabled:opacity-60"
              >
                {confirmando ? "Volver" : "Cancelar"}
              </button>
              <button
                onClick={() => (confirmando ? fusionar() : setConfirmando(true))}
                disabled={!data || !!error || fusionando || cargando}
                className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {fusionando ? "Fusionando…" : confirmando ? "Confirmar fusión" : "Revisar y fusionar"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
