"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Search, Check, X, UserCircle2, Loader2, UserPlus, Plus } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { COUNTRIES, formatPhone } from "@/lib/contact-format";
import { queFaltaParaElAlta } from "@/lib/contacto-alta";
import { DateField } from "@/components/ui/DateField";

type Contacto = { id: string; nombre_completo: string; email: string | null; telefono: string | null; tipo_cliente: string | null };
const TIPO_LABEL: Record<string, string> = { cliente: "Cliente", lead: "Lead", referido: "Referido" };

function initialsOf(name: string) {
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "??";
}

/**
 * Selector de contacto/cliente con busqueda en servidor (todos los contactos del CRM, no solo los cargados)
 * y filtro rapido "solo clientes". Reemplaza al picker estatico de 200 contactos.
 */
export function ContactoPicker({
  value, selectedNombre, onChange, autoFocus = false,
}: {
  value: string;
  selectedNombre?: string | null;
  onChange: (id: string, nombre?: string) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [soloClientes, setSoloClientes] = useState(false);
  const [results, setResults] = useState<Contacto[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedNombre, setPickedNombre] = useState<string | null>(selectedNombre || null);
  // --- Crear contacto inline ---
  const [creating, setCreating] = useState(false);
  const [cNombre, setCNombre] = useState("");
  const [cTelefono, setCTelefono] = useState("");
  const [cEmail, setCEmail] = useState("");
  // OPCIONAL (2026-08-31). Esta aqui porque antes el servidor la exigia y **este formulario no
  // tenia el campo**: el alta contestaba "falta la fecha de nacimiento" y no habia donde
  // escribirla. Ya no se exige, pero el campo se queda: quien la sepa la pone en el momento.
  const [cFechaNac, setCFechaNac] = useState("");
  const [cTipo, setCTipo] = useState<"lead" | "cliente" | "referido">("lead");
  const [cPais, setCPais] = useState("US");
  const [saving, setSaving] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPickedNombre(selectedNombre || null); }, [selectedNombre]);

  useEffect(() => {
    if (!open) { setQ(""); setCreating(false); return; }
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    // 🔴 EL CALENDARIO DEL ALTA VIVE FUERA DE ESTE ARBOL. `DateField` se portea a `document.body`,
    // asi que un dia del calendario **no es descendiente en el DOM** de `rootRef`. Estos dos
    // listeners son NATIVOS —recorren el DOM, no el arbol de React—, con lo que sin las dos
    // guardas de abajo elegir una fecha cerraria el desplegable entero y se perderia lo tecleado.
    const enElCalendario = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-datefield-popover]");
    const hayCalendarioAbierto = () => !!document.querySelector("[data-datefield-popover]");
    const onClick = (e: MouseEvent) => {
      if (enElCalendario(e.target)) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Con el calendario abierto, el `Escape` es suyo: lo cierra el (`DateField`) y este no hace
    // nada. El siguiente `Escape`, ya sin calendario, cierra el desplegable como siempre.
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !hayCalendarioAbierto()) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (term.length >= 2) params.set("q", term);
        if (soloClientes) params.set("tipo", "cliente");
        params.set("limit", "20");
        const r = await fetch(`/api/contactos/search?${params.toString()}`);
        const d = await r.json();
        if (!cancelled) setResults(Array.isArray(d.contactos) ? d.contactos : []);
      } catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setLoading(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, soloClientes, open]);

  const pick = (c: Contacto) => { onChange(c.id, c.nombre_completo); setPickedNombre(c.nombre_completo); setOpen(false); };
  const clear = () => { onChange("", undefined); setPickedNombre(null); };

  const startCreate = () => { setCErr(null); setCNombre(q.trim()); setCTelefono(""); setCEmail(""); setCFechaNac(""); setCTipo("lead"); setCPais("US"); setCreating(true); };
  const submitCreate = async () => {
    const nombre = cNombre.trim();
    const email = cEmail.trim();
    const pais = COUNTRIES.find((p) => p.code === cPais) || COUNTRIES[0];
    const phoneDigits = cTelefono.replace(/\D/g, "");
    // 🔴 LA MISMA REGLA QUE EL MODAL DE CONTACTOS, y del mismo modulo (§4.8). Aqui ponia
    // "telefono O email" mientras el servidor exigia LOS DOS: quien rellenaba solo el telefono
    // pasaba esta comprobacion y chocaba contra un 400. Eran dos reglas para lo mismo.
    const falta = queFaltaParaElAlta({ nombre, email, telefono: phoneDigits });
    if (falta) { setCErr(falta); return; }
    // Comprobacion PROPIA de esta pantalla, no una regla distinta de lo que hace falta: el campo
    // se teclea con formato y siete digitos es el minimo por debajo del cual es una errata.
    if (phoneDigits.length < 7) { setCErr("Ese teléfono parece incompleto. Revísalo antes de guardar."); return; }
    setSaving(true); setCErr(null);
    try {
      const body: any = { nombre_completo: nombre, tipo_cliente: cTipo, telefono: pais.dial + phoneDigits, email };
      // Solo si hay algo: vacia no se manda, en vez de mandar `""` a una columna `date`.
      if (cFechaNac) body.fecha_nacimiento = cFechaNac;
      const r = await fetch("/api/contactos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.contacto) { setCErr(typeof d.error === "string" ? d.error : "No se pudo crear el contacto"); setSaving(false); return; }
      const cc = d.contacto;
      onChange(cc.id, cc.nombre_completo);
      setPickedNombre(cc.nombre_completo);
      setCreating(false); setOpen(false);
      setCNombre(""); setCTelefono(""); setCEmail(""); setCFechaNac(""); setCTipo("lead"); setCPais("US");
    } catch { setCErr("Error de red al crear el contacto"); }
    finally { setSaving(false); }
  };
  const inputCls = "w-full h-9 px-3 rounded-lg bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20";
  const paisDial = (COUNTRIES.find((p) => p.code === cPais) || COUNTRIES[0]).dial;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        autoFocus={autoFocus}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group w-full h-11 px-3 rounded-xl border-2 text-[13px] outline-none transition-all flex items-center gap-2",
          value
            ? "bg-brand-orange/10 border-brand-orange/30 text-brand-orange"
            : "bg-neutral-50 dark:bg-white/5 border-transparent text-neutral-600 hover:bg-white hover:border-neutral-200",
          open && "bg-white border-brand-orange ring-4 ring-brand-orange/10"
        )}
      >
        <UserCircle2 className={cn("h-4 w-4 shrink-0", value ? "text-brand-orange" : "text-neutral-400")} strokeWidth={1.8} />
        <span className="truncate font-semibold flex-1 text-left">
          {value ? (pickedNombre || "Contacto seleccionado") : "Buscar contacto…"}
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); clear(); }}
            className="h-5 w-5 rounded-md hover:bg-brand-orange/20 flex items-center justify-center shrink-0"
            title="Quitar contacto"
          >
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className={cn("h-3.5 w-3.5 text-neutral-400 transition-transform shrink-0", open && "rotate-180")} strokeWidth={2} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="absolute z-[70] left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden"
          >
            {creating ? (
            <div className="p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500">Nuevo contacto</span>
                <button type="button" onClick={() => setCreating(false)} className="text-[11px] text-neutral-400 hover:text-neutral-600">Cancelar</button>
              </div>
              <input autoFocus value={cNombre} onChange={(e) => setCNombre(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }} placeholder="Nombre completo *" className={inputCls} />
              {/* El asterisco esta en los tres que el servidor exige. La fecha de nacimiento va sin
                  el, porque no lo es. */}
              <div className="flex gap-1.5">
                <select
                  value={cPais}
                  onChange={(e) => setCPais(e.target.value)}
                  className="h-9 px-1.5 rounded-lg bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20 w-[92px] shrink-0"
                  title="Codigo de pais"
                >
                  {COUNTRIES.map((p) => (
                    <option key={p.code} value={p.code}>{p.code} {p.dial}</option>
                  ))}
                </select>
                <input
                  value={formatPhone(cTelefono, paisDial)}
                  onChange={(e) => setCTelefono(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }}
                  inputMode="tel"
                  placeholder="Telefono *"
                  className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
                />
              </div>
              <input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); }} inputMode="email" autoComplete="email" placeholder="Email *" className={inputCls} />
              {/* El campo que faltaba, y por el que existe esta entrega: el alta pedia la fecha de
                  nacimiento y no habia donde escribirla. Es el MISMO selector que la ficha del
                  contacto y el modal del listado. `maxDate` en hoy porque nadie nace maniana. */}
              <DateField
                value={cFechaNac}
                onChange={setCFechaNac}
                maxDate={new Date()}
                placeholder="Fecha de nacimiento"
                size="sm"
                typeable
              />
              <div className="flex gap-1.5">
                {(["lead", "cliente", "referido"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setCTipo(t)} className={cn("flex-1 h-8 rounded-lg text-[11px] font-ui font-bold uppercase tracking-wide border transition", cTipo === t ? "bg-brand-orange text-white border-brand-orange" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300")}>
                    {TIPO_LABEL[t]}
                  </button>
                ))}
              </div>
              {cErr && <div className="text-[11px] text-red-500 px-0.5">{cErr}</div>}
              <button type="button" disabled={saving} onClick={submitCreate} className="w-full h-9 rounded-lg bg-brand-orange text-white text-[12px] font-ui font-bold uppercase tracking-wider hover:bg-brand-orange/90 disabled:opacity-60 flex items-center justify-center gap-2">
                {saving ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creando</>) : (<><Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Crear y seleccionar</>)}
              </button>
            </div>
            ) : (
              <>
            <div className="p-2 border-b border-neutral-100 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre, email o telefono…"
                  className="w-full h-9 pl-8 pr-3 rounded-lg bg-neutral-50 border border-transparent text-sm outline-none focus:bg-white focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
                />
              </div>
              <button
                type="button"
                onClick={() => setSoloClientes((s) => !s)}
                className={cn(
                  "h-6 px-2.5 rounded-full text-[10px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 transition-all border",
                  soloClientes ? "bg-brand-orange text-white border-brand-orange" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-300"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", soloClientes ? "bg-white" : "bg-brand-orange")} />
                Solo clientes
              </button>
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1">
              {loading && (
                <div className="px-4 py-3 text-center text-[12px] text-neutral-400 flex items-center justify-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
                </div>
              )}
              {!loading && results.length === 0 && (
                <div className="px-4 py-3 text-center text-[12px] text-neutral-400">Sin resultados</div>
              )}
              {!loading && results.map((c) => {
                const isSel = c.id === value;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pick(c)}
                    className={cn("w-full px-3 py-2 text-left text-[13px] flex items-center gap-2.5 hover:bg-neutral-50 transition-colors", isSel && "bg-brand-orange/5")}
                  >
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                      {initialsOf(c.nombre_completo)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn("truncate", isSel && "font-semibold text-brand-orange")}>{c.nombre_completo}</div>
                      <div className="text-[10px] text-neutral-400 truncate">
                        {[c.email || c.telefono, TIPO_LABEL[c.tipo_cliente || ""] || c.tipo_cliente].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    {isSel && <Check className="h-3.5 w-3.5 text-brand-orange shrink-0" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
            <div className="p-2 border-t border-neutral-100 flex gap-2">
              <button
                type="button"
                onClick={startCreate}
                className="flex-1 h-9 rounded-lg border border-dashed border-brand-orange/50 text-brand-orange text-[12px] font-ui font-bold flex items-center justify-center gap-2 hover:bg-brand-orange/5 transition"
              >
                <UserPlus className="h-3.5 w-3.5" strokeWidth={2.2} /> Crear nuevo
              </button>
            </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
