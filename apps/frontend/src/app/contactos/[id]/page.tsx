"use client";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft, User, Mail, Phone, MessageSquare, FileText, DollarSign, MapPin,
  Shield, Users as UsersIcon, CheckSquare, Edit3, Save, X, Loader2, Briefcase, Globe, Lock, Eye, EyeOff, ArrowUpRight, Heart, Languages, FolderOpen, Tag, Download, StickyNote, FileType, ChevronDown, ChevronRight, Send, Plus, Trash2, Paperclip, Archive, LayoutGrid, List, WhatsappLogo
} from "@/lib/bootstrap-icons";
import { ConfirmarArchivadoModal } from "@/components/contactos/ConfirmarArchivadoModal";
import { ElegirConexionWhatsAppModal } from "@/components/whatsapp/ElegirConexionWhatsAppModal";
import type { WhatsAppConexion } from "@/components/whatsapp/types";
import { useFileDrop } from "@/lib/useFileDrop";
import { NewFileChip, ExistingArchivoChip, type NotaArchivoT } from "@/components/ui/NotaAttachmentChips";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn, edadEnAnios, fmtFechaSolo } from "@/lib/utils";
import { nombreEnDosLineas, nombreParaEncabezado, usaRespaldoDeNombre } from "@/lib/nombre-contacto";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DateField } from "@/components/ui/DateField";
import { FancySelect } from "@/components/ui/FancySelect";
import { FilePreviewModal, type DriveFile } from "@/components/drive/DriveBrowser";
import { MiniaturaArchivo } from "@/components/drive/MiniaturaArchivo";
import { FileThumbCard } from "@/components/drive/FileThumbCard";
import { aplanarDocumentos, type DocumentosAplanados } from "@/lib/documentos-contacto";
import EmailComposeModal from "@/components/correo/EmailComposeModal";
import { TaskModal } from "@/components/tareas/TaskModal";

type Tab = "resumen" | "documentos" | "notas" | "negociaciones" | "tareas" | "referidos";

const ESTATUS_OPTS = [
  { value: "ciudadano", label: "Ciudadano", color: "#2196C9" },
  { value: "residente", label: "Residente", color: "#43A847" },
  { value: "asilo_pendiente", label: "Asilo pendiente", color: "#5750E8" },
  { value: "permiso_trabajo", label: "Permiso de trabajo", color: "#FFB51C" },
  { value: "tps", label: "TPS", color: "#8338EC" },
  { value: "daca", label: "DACA", color: "#06FFA5" },
  { value: "visa_u", label: "Visa U", color: "#3A86FF" },
  { value: "visa_t", label: "Visa T", color: "#FB5607" },
  { value: "indocumentado", label: "Indocumentado", color: "#E53935" },
  { value: "otros", label: "Otros", color: "#5C6670" }
];

const CIUDADANO_OPTS = [
  { value: "naturalizado", label: "Naturalizado" },
  { value: "nativo", label: "Nativo" }
];

const ESTADO_CIVIL_OPTS = [
  { value: "soltero", label: "Soltero(a)" },
  { value: "casado", label: "Casado(a)" },
  { value: "divorciado", label: "Divorciado(a)" },
  { value: "viudo", label: "Viudo(a)" },
  { value: "union_libre", label: "Unión libre" },
  { value: "separado", label: "Separado(a)" }
];

const GENERO_OPTS = [
  { value: "masculino", label: "Masculino" },
  { value: "femenino", label: "Femenino" },
  { value: "otro", label: "Otro" }
];

const TIPO_CLIENTE_OPTS = [
  { value: "lead", label: "Lead", color: "#2196C9" },
  { value: "referido", label: "Referido", color: "#5750E8" },
  { value: "cliente", label: "Cliente", color: "#43A847" }
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR"
];

/**
 * El texto que acompania a la fecha de nacimiento: `«46 anios»`, o nada.
 *
 * Vive aqui y no en `FieldDate` porque es lo unico de esta pantalla que sabe que ESA fecha
 * significa un nacimiento. Y no vive en `lib/utils.ts` porque alli esta el calculo, que es
 * reutilizable; esto es su redaccion, que es de esta ficha.
 *
 * Sin fecha, fecha corrupta o futura -> `null`, y entonces no se pinta nada: la ficha queda
 * exactamente como estaba. Un `0` o un guion serian afirmar algo que no se sabe.
 */
function sufijoEdad(fechaNacimiento: any): string | null {
  const anios = edadEnAnios(fechaNacimiento);
  if (anios === null) return null;
  return `${anios} año${anios === 1 ? "" : "s"}`;
}

export default function ContactoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("resumen");

  /**
   * T3 · `?tab=documentos` abre la ficha directamente en esa pestaña.
   *
   * Lo usa el escalón de vuelta de la pestaña Documentos de una negociación: sin esto aterrizaría
   * en «Resumen» y habría que volver a buscar la pestaña a mano, que es justo el paseo que la
   * reunión del 2026-08-24 quería quitar.
   *
   * ⚠️ Se lee en un EFECTO y no en el estado inicial, igual que la preferencia de vista de esta
   * misma pantalla: el servidor pinta «resumen» y si el cliente arrancara con otra cosa se
   * rompería la hidratación de Next.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pedida = new URLSearchParams(window.location.search).get("tab");
    const validas: Tab[] = ["resumen", "documentos", "notas", "negociaciones", "tareas", "referidos"];
    if (pedida && (validas as string[]).includes(pedida)) setTab(pedida as Tab);
  }, []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [showPasswords, setShowPasswords] = useState(false);
  /**
   * 🔴 LOS VALORES SENSIBLES VAN EN SU PROPIO ESTADO, **NUNCA DENTRO DE `form`**.
   *
   * `save()` hace `payload = { ...form }`: si el SSN o las claves entraran ahí, cada guardado los
   * devolvería al servidor — y bastaría un fallo de red o un `PATCH` a medias para reescribirlos.
   * Hoy no pasa porque nunca llegan del backend; en cuanto empiezan a llegar, mantenerlos fuera
   * deja de ser gratis y pasa a ser una decisión que hay que sostener.
   *
   * Se piden al pulsar el ojo y **se borran al volver a pulsarlo**: no se quedan vivos en memoria
   * más tiempo del que están en pantalla.
   */
  const [sensibles, setSensibles] = useState<Record<string, string | null> | null>(null);
  const [cargandoSensibles, setCargandoSensibles] = useState(false);
  const [pdFiles, setPdFiles] = useState<any>(null);
  // Los dos agentes de seguro, resueltos POR EL SERVIDOR. Antes esto cargaba `/api/users` entero y
  // la ficha ofrecia a todo el equipo en una lista donde no pintaba nada.
  const [agentes, setAgentes] = useState<AgenteOfrecido[]>([]);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  /**
   * 🔴 El visor guarda el INDICE dentro del recorrido, no el archivo.
   *
   * Guardar el archivo obligaria a buscarlo en la lista cada vez que se pulsa una flecha, y ese
   * "buscar" es justo donde el orden puede discrepar. Con el indice, avanzar es sumar uno.
   */
  const [previewIndice, setPreviewIndice] = useState<number | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [confirmarArchivado, setConfirmarArchivado] = useState(false);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [elegirConexionWa, setElegirConexionWa] = useState<WhatsAppConexion[] | null>(null);

  const contactarPorWhatsApp = async (conexionId?: string) => {
    setWhatsappBusy(true);
    try {
      let destino = conexionId;
      if (!destino) {
        const r = await fetch("/api/whatsapp/conexiones");
        const lista: WhatsAppConexion[] = await r.json();
        const conectadas = lista.filter((x) => x.estado === "conectado");
        if (conectadas.length === 0) { toast.error("No hay ningún número de WhatsApp conectado todavía."); return; }
        if (conectadas.length > 1) { setElegirConexionWa(conectadas); return; }
        destino = conectadas[0].id;
      }
      const r2 = await fetch("/api/whatsapp/conversaciones/abrir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacto_id: id, conexion_id: destino }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error || "No se pudo abrir la conversación");
      setElegirConexionWa(null);
      router.push(`/whatsapp?conversacion=${d2.conversacion_id}`);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo contactar por WhatsApp");
    } finally {
      setWhatsappBusy(false);
    }
  };

  const load = useCallback(async () => {
    const r = await fetch(`/api/contactos/${id}`);
    if (!r.ok) { toast.error("Contacto no encontrado"); router.push("/contactos"); return; }
    const d = await r.json();
    setData(d);
    setForm(d.contacto);
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/contactos/agentes-seguro").then((r) => (r.ok ? r.json() : null)).then((d) => setAgentes(d?.agentes || [])).catch(() => {});
  }, []);

  /**
   * El recorrido de documentos, calculado UNA sola vez y compartido por la lista, la galeria y
   * las flechas del visor. Ver `lib/documentos-contacto.ts`: si cada vista calculara el suyo, el
   * «3 / 47» acabaria mintiendo sin que nada llegue a fallar.
   */
  const documentos: DocumentosAplanados = useMemo(() => aplanarDocumentos(pdFiles?.folders), [pdFiles]);
  const docActual = previewIndice === null ? null : documentos.planos[previewIndice] ?? null;

  /**
   * Ir a un documento por su puesto en el recorrido.
   *
   * ⚠️ Despliega la carpeta del destino si estaba plegada. Las flechas cruzan carpetas —el
   * recorrido ignora si estan abiertas o cerradas—, asi que sin esto al cerrar el visor el
   * usuario no veria donde se quedo: la fila estaria dentro de una carpeta que sigue plegada.
   */
  const irADocumento = useCallback((indice: number) => {
    const destino = documentos.planos[indice];
    if (!destino) return;
    setPreviewIndice(indice);
    setOpenFolders((prev) => (prev[destino.folderId] === false ? { ...prev, [destino.folderId]: true } : prev));
  }, [documentos]);

  /**
   * Los documentos del contacto: SU DRIVE, organizado por negociación, más lo importado.
   *
   * El Drive se pide siempre —lo tiene cualquier contacto—; los tres endpoints de importados solo
   * cuando el contacto viene de ese origen, que es cuando pueden devolver algo. Se fusionan en
   * una sola lista de grupos porque la pestaña es una: negociaciones primero, «General» después,
   * y los importados al final, que es donde se van a buscar.
   */
  useEffect(() => {
    const c = data?.contacto;
    if (!c) return;
    (async () => {
      try {
        const drive = await fetch(`/api/contactos/${id}/documentos`).then((r) => (r.ok ? r.json() : null));

        // El Drive llega como `grupos`; se traduce a la forma que consume `aplanarDocumentos`.
        const folders = (drive?.grupos || []).map((g: any) => ({
          folder_id: g.oportunidad_id || g.folder_id || `grupo-${g.nombre}`,
          folder_nombre: g.tipo === "general" ? g.nombre : `Negociación · ${g.nombre}`,
          files: g.files || [],
        }));
        const total = drive?.total || 0;

        setPdFiles({ folders, total, source: "ok" });
        const init: Record<string, boolean> = {};
        for (const f of folders) init[f.folder_id] = true;
        setOpenFolders(init);
      } catch { setPdFiles({ folders: [], total: 0 }); }
    })();
  }, [id, data?.contacto]);

  /**
   * Pide (u oculta) los tres datos sensibles.
   *
   * Cada revelado es una petición al endpoint dedicado, y cada petición deja una fila en la
   * bitácora: por eso no se cachean entre aperturas de la ficha ni se piden con el resto del
   * detalle. Ocultar **borra** los valores del estado.
   */
  const alternarSensibles = async () => {
    if (showPasswords) { setShowPasswords(false); setSensibles(null); return; }
    setCargandoSensibles(true);
    try {
      const r = await fetch(`/api/contactos/${id}/datos-sensibles`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "No se pudieron obtener los datos");
      setSensibles(d);
      setShowPasswords(true);
    } catch (e: any) { toast.error(e.message); } finally { setCargandoSensibles(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = { ...form };
      delete payload.ref_id; delete payload.ref_nombre;
      // El responsable se asigna desde la acción masiva del listado, no desde la ficha: aquí solo
      // se lee. Se quitan los dos igual que `ref_nombre` — el servidor ya los descarta (no están en
      // `ContactoFullSchema`), pero decirlo aquí deja claro que no es un olvido.
      delete payload.responsable_nombre; delete payload.responsable_user_id;
      delete payload.created_at; delete payload.updated_at; delete payload.id;
      // 🔴 `nombre_completo` NO SE MANDA. Ya no se teclea en ninguna parte: lo compone el
      // servidor a partir de Nombre, Segundo nombre y Apellidos (`buildNombreCompleto`), y esa
      // funcion devuelve lo que reciba en `nombre_completo` SI SE LO MANDAN — con lo que mandarlo
      // impediria el recalculo y editar las partes no cambiaria el encabezado.
      //
      // ⚠️ Y la salvaguarda esta en el servidor, no aqui: si las TRES partes estan vacias no
      // recalcula nada y deja el valor guardado en paz. Es el caso de los 33 contactos cuyo unico
      // nombre vive en esa columna — pisarlo con una cadena vacia les borraria el nombre.
      delete payload.nombre_completo;
      const r = await fetch(`/api/contactos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error?.[0]?.message || e.error || "Error"); }
      toast.success("Guardado");
      setEditing(false);
      load();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (!data) {
    return <AppShell><div className="p-10"><div className="glass rounded-3xl p-10 h-64 skeleton" /></div></AppShell>;
  }

  const c = form;
  const estatusOpt = ESTATUS_OPTS.find((o) => o.value === c.estatus_migratorio_tipo);
  const tipoOpt = TIPO_CLIENTE_OPTS.find((o) => o.value === c.tipo_cliente);

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <button onClick={() => router.push("/contactos")} className="flex items-center gap-2 text-xs text-neutral-500 hover:text-brand-orange font-ui uppercase tracking-wider mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a contactos
        </button>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl border border-neutral-100 p-6 mb-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-orange to-brand-gold text-white text-xl font-black flex items-center justify-center shrink-0">
              {(c.nombre_completo || "??").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[10px] tracking-[0.12em] mb-1">
                <User className="h-3 w-3" strokeWidth={2} />
                Contacto
              </div>
              {/* ════════════════════════════════════════════════════════════════════════════
                  EL NOMBRE ES UNA ETIQUETA, TAMBIEN EN EDICION
                  ════════════════════════════════════════════════════════════════════════════
                  Aqui habia un <input> que escribia sobre `nombre_completo` DIRECTAMENTE. Eso
                  creaba dos verdades sobre como se llama alguien: la de arriba y la de los tres
                  campos de Informacion personal, que podian decir cosas distintas sin que nada
                  fallara. Ahora se edita abajo y se lee arriba.

                  🔴 Con respaldo: si la composicion diria MENOS que `nombre_completo`, se lee
                  `nombre_completo`. Ver `lib/nombre-contacto.ts` — 33 contactos vivos no tienen
                  ninguna parte y 160 no tienen apellido; sin el respaldo, esos 193 verian menos
                  nombre del que ven hoy. */}
              <h1 className="font-display text-3xl font-black leading-tight">{nombreParaEncabezado(c)}</h1>
              {editing && usaRespaldoDeNombre(c) && (
                // Solo al editar, y solo si de verdad se esta respaldando. Sin este aviso el
                // respaldo funciona tan bien que nadie se entera de que hay algo que rellenar, y
                // las 33 fichas incompletas se quedan incompletas para siempre.
                <p className="text-[11px] text-amber-700 mt-1">
                  Este nombre viene de la importacion y todavia no esta repartido en Nombre,
                  Segundo nombre y Apellidos. Al rellenarlos, el encabezado pasa a componerse de ellos.
                </p>
              )}
              <div className="flex items-center gap-3 text-[12px] text-neutral-500 flex-wrap mt-1">
                {tipoOpt && <span className="px-2 py-0.5 rounded-full text-[10px] font-ui font-bold uppercase tracking-wider text-white" style={{ backgroundColor: tipoOpt.color }}>{tipoOpt.label}</span>}
                {estatusOpt && <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: estatusOpt.color }} />{estatusOpt.label}</span>}
                {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}
                {c.telefono && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.telefono}</span>}
                {data.referido_por && <span className="inline-flex items-center gap-1"><UsersIcon className="h-3 w-3" /> Ref. por <strong className="text-neutral-700">{data.referido_por.nombre_completo}</strong></span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {editing ? (
                <>
                  <button onClick={() => { setEditing(false); setForm(data.contacto); }} className="h-10 px-4 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-700 hover:bg-neutral-50">Cancelar</button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={save} disabled={saving} className="h-10 px-5 gradient-orange rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-brand-orange/25 disabled:opacity-60 flex items-center gap-2">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <Save className="h-3.5 w-3.5" /> Guardar
                  </motion.button>
                </>
              ) : (
                <>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => setEditing(true)} className="h-10 px-4 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 flex items-center gap-2">
                    <Edit3 className="h-3.5 w-3.5" /> Editar
                  </motion.button>
                  {c.email && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setShowEmailModal(true)}
                      className="h-10 px-4 rounded-xl bg-emerald-100 text-emerald-700 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-emerald-200 flex items-center gap-2"
                      title="Enviar email a este contacto"
                    >
                      <Send className="h-3.5 w-3.5" /> Enviar email
                    </motion.button>
                  )}
                  {(c.telefono || (c as any).whatsapp) && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => contactarPorWhatsApp()}
                      disabled={whatsappBusy}
                      className="h-10 px-4 rounded-xl bg-green-100 text-green-700 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-green-200 flex items-center gap-2 disabled:opacity-60"
                      title="Contactar por WhatsApp"
                    >
                      {whatsappBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WhatsappLogo className="h-3.5 w-3.5" weight="fill" />}
                      WhatsApp
                    </motion.button>
                  )}
                  {/* Eliminar = ARCHIVAR. Nunca borra. El diálogo dice antes qué arrastra (R2);
                      la autorización real la decide el backend, esto es solo UX (§4.2). */}
                  {!c.archivado && (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setConfirmarArchivado(true)}
                      className="h-10 px-4 rounded-xl bg-red-50 text-red-600 font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-red-100 flex items-center gap-2"
                      title="Archivar este contacto (reversible)"
                    >
                      <Archive className="h-3.5 w-3.5" /> Eliminar
                    </motion.button>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>

        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2">
          {/* 🔴 T3 · «Hay unos contactos a los que les aparece el apartado de documentos y por
              qué otros no» (Juan Manuel, 2026-08-24). No era intermitente: la pestaña estaba
              condicionada a que el contacto viniera de un CRM externo (Pipedrive/Zoho/Bitrix,
              ya sin soporte), porque lo único que sabía enseñar eran los archivos IMPORTADOS de
              esos orígenes. Un contacto creado en el CRM no tenía dónde ver sus documentos. Ahora
              tanto "documentos" (lee el Drive del contacto) como "notas" (siempre locales) salen
              SIEMPRE, para cualquier contacto. */}
          {(["resumen", "documentos", "notas", "negociaciones", "tareas", "referidos"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("h-10 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider transition whitespace-nowrap", tab === t ? "gradient-orange text-white shadow-glow" : "bg-white text-neutral-500 hover:bg-neutral-50 border border-neutral-100")}>
              {t}
              {t === "documentos" && pdFiles?.total ? <span className="ml-1.5 text-[10px] opacity-80">({pdFiles.total})</span> : null}
              {t === "negociaciones" && data.oportunidades?.length > 0 && <span className="ml-1.5 text-[10px] opacity-80">({data.oportunidades.length})</span>}
              {t === "tareas" && data.tareas?.length > 0 && <span className="ml-1.5 text-[10px] opacity-80">({data.tareas.length})</span>}
              {t === "referidos" && data.referidos?.length > 0 && <span className="ml-1.5 text-[10px] opacity-80">({data.referidos.length})</span>}
            </button>
          ))}
        </div>

        {tab === "resumen" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card icon={User} title="Información personal">
              <Grid>
                <Field label="Nombre" value={c.nombre} onChange={(v) => setForm({ ...form, nombre: v })} editing={editing} />
                <Field label="Segundo nombre" value={c.segundo_nombre} onChange={(v) => setForm({ ...form, segundo_nombre: v })} editing={editing} />
                {/* 🔴 SOLO LA ETIQUETA. La columna se sigue llamando `apellido` (§4.7: los nombres
                    internos son contratos y renombrarlos por estetica rompe cosas). En plural
                    porque un contacto puede tener uno o varios y el campo ya los admite. */}
                <Field label="Apellidos" value={c.apellido} onChange={(v) => setForm({ ...form, apellido: v })} editing={editing} />
                <FieldDate label="Fecha de nacimiento" value={c.fecha_nacimiento} onChange={(v) => setForm({ ...form, fecha_nacimiento: v })} editing={editing} sufijo={sufijoEdad(c.fecha_nacimiento)} />
                <FieldSelect label="Estado civil" value={c.estado_civil} onChange={(v) => setForm({ ...form, estado_civil: v || null })} options={ESTADO_CIVIL_OPTS} editing={editing} />
                <FieldSelect label="Género" value={c.genero} onChange={(v) => setForm({ ...form, genero: v || null })} options={GENERO_OPTS} editing={editing} />
                <Field label="Idioma" value={c.idioma} onChange={(v) => setForm({ ...form, idioma: v })} editing={editing} icon={Languages} />
                {/* 🔴 Al marcar que NO tiene seguro se limpian LAS DOS columnas del agente, aqui y
                    en el servidor. Un contacto sin seguro con agente asignado es justo el estado
                    que ensuciaria la segmentacion por agente. */}
                <FieldBool
                  label="Tiene seguro de salud"
                  value={c.tiene_seguro_salud}
                  onChange={(v) => setForm(v === true
                    ? { ...form, tiene_seguro_salud: v }
                    : { ...form, tiene_seguro_salud: v, agente_seguro_id: null, agente_seguro_otro: null })}
                  editing={editing}
                  icon={Heart}
                />
                {/* Solo si tiene seguro. Sin esa condicion, el desplegable invitaria a rellenar un
                    dato que el servidor va a borrar en cuanto se guarde. */}
                {c.tiene_seguro_salud === true && (
                  <FieldAgenteSeguro contacto={data.contacto} form={form} setForm={setForm} editing={editing} agentes={agentes} />
                )}
                {/* 🔴 Quién lleva este contacto. Se ASIGNA desde la acción masiva del listado y
                    hasta ahora no se veía en ninguna parte: la ficha no podía pintarlo porque la
                    API no lo mandaba. Es de solo lectura aquí — se cambia desde el listado, que es
                    donde está la acción. */}
                <FieldResponsable
                  nombre={data.contacto?.responsable_nombre}
                  id={c.responsable_user_id}
                />
              </Grid>
            </Card>

            <Card icon={Shield} title="Estatus migratorio" accent={estatusOpt?.color}>
              <Grid>
                <FieldSelect label="Estatus" value={c.estatus_migratorio_tipo} onChange={(v) => setForm({ ...form, estatus_migratorio_tipo: v || null, ciudadano_tipo: v === "ciudadano" ? form.ciudadano_tipo : null })} options={ESTATUS_OPTS} editing={editing} fullWidth />
                {c.estatus_migratorio_tipo === "ciudadano" && <FieldSelect label="Tipo ciudadano" value={c.ciudadano_tipo} onChange={(v) => setForm({ ...form, ciudadano_tipo: v || null, a_number: v === "nativo" ? null : form.a_number })} options={CIUDADANO_OPTS} editing={editing} fullWidth />}
                {c.estatus_migratorio_tipo === "otros" && <Field label="Describe" value={c.estatus_migratorio_otros} onChange={(v) => setForm({ ...form, estatus_migratorio_otros: v })} editing={editing} fullWidth />}
                {(c.estatus_migratorio_tipo !== "ciudadano" || c.ciudadano_tipo === "naturalizado") && <Field label="A-Number" value={c.a_number} onChange={(v) => setForm({ ...form, a_number: v })} editing={editing} placeholder="A123456789" required={c.ciudadano_tipo === "naturalizado"} />}
                <Field label="SSN" value={c.ssn_encrypted} revelado={sensibles?.ssn_encrypted} onChange={(v) => setForm({ ...form, ssn_encrypted: v })} editing={editing} placeholder="XXX-XX-XXXX" sensitive={!showPasswords} guardado={data.contacto.tiene_ssn} />
                <Field label="ITIN" value={c.itin} onChange={(v) => setForm({ ...form, itin: v })} editing={editing} />
                <Field label="Pasaporte #" value={c.pasaporte_numero} onChange={(v) => setForm({ ...form, pasaporte_numero: v })} editing={editing} />
                <Field label="País pasaporte" value={c.pasaporte_pais} onChange={(v) => setForm({ ...form, pasaporte_pais: v })} editing={editing} />
              </Grid>
            </Card>

            <Card icon={Mail} title="Contacto">
              <Grid>
                {/* 🔴 UNA SOLA COLUMNA. Antes esto leia `correo_personal || email` y ESCRIBIA LAS
                    DOS A LA VEZ, mientras el listado leia solo `email`: por eso un contacto podia
                    verse con correo aqui y sin correo alli. Desde la mig. 0071 la unica fuente es
                    `email`; `correo_personal` sigue en la tabla (§0, no se borra nada) pero ni se
                    lee ni se escribe.
                    ⚠️ Solo cambia la ETIQUETA: la columna se sigue llamando `email` (§4.7). */}
                <Field label="Email" value={c.email} onChange={(v) => setForm({ ...form, email: v })} editing={editing} icon={Mail} />
                <Field label="Teléfono" value={c.telefono} onChange={(v) => setForm({ ...form, telefono: v })} editing={editing} icon={Phone} />
                <Field label="WhatsApp" value={c.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} editing={editing} icon={MessageSquare} />
                <Field label="Empleador" value={c.empleador_actual} onChange={(v) => setForm({ ...form, empleador_actual: v })} editing={editing} icon={Briefcase} />
              </Grid>
            </Card>

            <Card icon={MapPin} title="Dirección">
              <Grid>
                <Field label="Calle y número" value={c.direccion_calle} onChange={(v) => setForm({ ...form, direccion_calle: v })} editing={editing} fullWidth />
                <Field label="Línea 2 (apt, suite)" value={c.direccion_linea2} onChange={(v) => setForm({ ...form, direccion_linea2: v })} editing={editing} fullWidth />
                <Field label="Ciudad" value={c.direccion_ciudad} onChange={(v) => setForm({ ...form, direccion_ciudad: v })} editing={editing} />
                <FieldSelect label="Estado" value={c.direccion_estado} onChange={(v) => setForm({ ...form, direccion_estado: v || null })} options={US_STATES.map((s) => ({ value: s, label: s }))} editing={editing} />
                <Field label="Código postal" value={c.direccion_cp} onChange={(v) => setForm({ ...form, direccion_cp: v })} editing={editing} />
                <Field label="País" value={c.direccion_pais} onChange={(v) => setForm({ ...form, direccion_pais: v })} editing={editing} />
                <FieldBool label="Recibe correo postal" value={c.recibe_correo_postal} onChange={(v) => setForm({ ...form, recibe_correo_postal: v })} editing={editing} fullWidth />
              </Grid>
            </Card>

            {/* Este ojo gobierna los TRES campos: las dos claves de aquí y el SSN de la tarjeta de
                estatus. Pulsarlo pide los valores al endpoint dedicado —que deja constancia de la
                consulta—; volver a pulsarlo los oculta Y los borra del estado.
                🔴 El control se enseña SIEMPRE (§4.2): sin permiso sale deshabilitado y diciendo
                por qué, no escondido. La barrera de verdad está en el servidor. */}
            <Card icon={Lock} title="Credenciales USCIS" actions={
              <button
                onClick={alternarSensibles}
                disabled={cargandoSensibles || !data.contacto.puede_ver_sensibles}
                title={
                  data.contacto.puede_ver_sensibles
                    ? (showPasswords ? "Ocultar los datos sensibles" : "Ver los datos sensibles — la consulta queda registrada")
                    : "Tu cuenta ya no está activa. Habla con un administrador."
                }
                className="h-8 w-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {cargandoSensibles
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }>
              <Grid>
                <Field label="Email USCIS" value={c.correo_uscis} onChange={(v) => setForm({ ...form, correo_uscis: v })} editing={editing} fullWidth icon={Mail} />
                <Field label="Usuario USCIS" value={c.usuario_uscis} onChange={(v) => setForm({ ...form, usuario_uscis: v })} editing={editing} />
                <Field label="Clave email USCIS" value={c.clave_correo_uscis_enc} revelado={sensibles?.clave_correo_uscis_enc} onChange={(v) => setForm({ ...form, clave_correo_uscis_enc: v })} editing={editing} sensitive={!showPasswords} guardado={data.contacto.tiene_clave_correo_uscis} />
                <Field label="Clave USCIS" value={c.clave_uscis_enc} revelado={sensibles?.clave_uscis_enc} onChange={(v) => setForm({ ...form, clave_uscis_enc: v })} editing={editing} sensitive={!showPasswords} guardado={data.contacto.tiene_clave_uscis} fullWidth />
              </Grid>
            </Card>

            <Card icon={UsersIcon} title="Información del referido" accent="#5750E8">
              <Grid>
                <FieldSelect label="Tipo de cliente" value={c.tipo_cliente} onChange={(v) => setForm({ ...form, tipo_cliente: v || null })} options={TIPO_CLIENTE_OPTS} editing={editing} />
                <FieldStat label="Saldo disponible" value={`$${Number(c.saldo_referidos_usd || 0).toFixed(2)}`} color="#43A847" />
                {c.tipo_cliente === "referido" && <FieldReferidoPor value={c.referido_por_contacto_id} refNombre={data.referido_por?.nombre_completo} onChange={(v) => setForm({ ...form, referido_por_contacto_id: v })} editing={editing} />}
                <FieldStat label="Personas que refirió" value={String(data.referidos?.length || 0)} color="#2196C9" />
              </Grid>
            </Card>
          </div>
        )}

        {tab === "documentos" && (
          <DocumentosTab
            pdFiles={pdFiles}
            documentos={documentos}
            openFolders={openFolders}
            setOpenFolders={setOpenFolders}
            onPreview={irADocumento}
          />
        )}
        {tab === "notas" && <NotasTab contactoId={id} />}

        {tab === "negociaciones" && <NegociacionesList abiertas={data.oportunidades_abiertas || []} cerradas={data.oportunidades_cerradas || []} />}
        {tab === "tareas" && (
          <TareasList
            tareas={data.tareas || []}
            contactoId={id}
            contactoNombre={nombreParaEncabezado(data.contacto)}
            onReload={load}
          />
        )}
        {tab === "referidos" && <ReferidosList referidos={data.referidos || []} onNav={(rid: string) => router.push(`/contactos/${rid}`)} />}
      </div>

      {/* Las flechas se pasan SIEMPRE que haya recorrido, tambien en los extremos: el visor las
          desactiva a partir de `posicion`, y asi no se le mueven los botones bajo el cursor. */}
      {docActual && (
        <FilePreviewModal
          file={docActual.file}
          onClose={() => setPreviewIndice(null)}
          onPrev={() => irADocumento(docActual.indice - 1)}
          onNext={() => irADocumento(docActual.indice + 1)}
          posicion={{ indice: docActual.indice, total: documentos.planos.length }}
        />
      )}
      <EmailComposeModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        contactoId={id}
        toEmail={(c?.email || "").trim()}
        toName={c?.nombre_completo || (c?.nombre ? `${c.nombre} ${c.apellido || ""}`.trim() : undefined)}
        onSent={() => toast.success("Correo enviado")}
      />
      {elegirConexionWa && (
        <ElegirConexionWhatsAppModal
          conexiones={elegirConexionWa}
          onClose={() => setElegirConexionWa(null)}
          onElegir={(conexion) => contactarPorWhatsApp(conexion.id)}
        />
      )}
      <ConfirmarArchivadoModal
        abierto={confirmarArchivado}
        seleccion={confirmarArchivado ? { modo: "ids", ids: [id] } : null}
        nombreUnico={data.contacto?.nombre_completo || null}
        onCancelar={() => setConfirmarArchivado(false)}
        onConfirmar={async () => {
          try {
            const r = await fetch(`/api/contactos/${id}`, { method: "DELETE" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.error || "No se pudo archivar");
            setConfirmarArchivado(false);
            toast.success("Contacto archivado");
            router.push("/contactos");
          } catch (e: any) {
            toast.error(e?.message || "No se pudo archivar");
          }
        }}
      />
    </AppShell>
  );
}

const VISTA_DOCS_KEY = "contactos:documentos:vista";

/**
 * La pestania Documentos.
 *
 * Dos vistas sobre EL MISMO recorrido (`documentos`, calculado en la pagina): la lista agrupada
 * por carpeta —la de siempre, y la de por defecto, porque es la que deja leer nombres como
 * `AuditTrail_-Terminos_y_Condiciones-Asilo-Jorge_Luis_Arce_Aguilar.pdf`— y la galeria.
 *
 * `onPreview` recibe el INDICE en el recorrido, no el archivo: es lo que permite que las flechas
 * del visor sigan el mismo orden que se esta viendo en pantalla.
 */
function DocumentosTab({ pdFiles, documentos, openFolders, setOpenFolders, onPreview }: {
  pdFiles: any;
  documentos: DocumentosAplanados;
  openFolders: Record<string, boolean>;
  setOpenFolders: (s: Record<string, boolean>) => void;
  onPreview: (indice: number) => void;
}) {
  const [vista, setVista] = useState<"list" | "grid">("list");

  // 🔴 La preferencia se lee en un efecto y NO en el estado inicial. Leer `localStorage` al
  // construir el estado rompe la hidratacion: el servidor pinta "list" y el cliente pintaria
  // otra cosa en el primer render. Asi el primer pintado coincide y luego se ajusta.
  useEffect(() => {
    const guardada = typeof window === "undefined" ? null : window.localStorage.getItem(VISTA_DOCS_KEY);
    if (guardada === "grid" || guardada === "list") setVista(guardada);
  }, []);

  const cambiarVista = (v: "list" | "grid") => {
    setVista(v);
    // Preferencia de quien mira, no dato de negocio: no merece ni columna ni endpoint.
    try { window.localStorage.setItem(VISTA_DOCS_KEY, v); } catch { /* modo incognito, da igual */ }
  };

  if (pdFiles === null) {
    return <div className="bg-white rounded-2xl border border-neutral-100 p-10 text-center text-sm text-neutral-400">Cargando documentos…</div>;
  }
  if (!pdFiles || pdFiles.total === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-100 p-12 text-center">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-purple-100 mb-4">
          <FolderOpen className="h-8 w-8 text-purple-600" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg font-black mb-1">Sin documentos</h3>
        <p className="text-xs text-neutral-500">Este contacto todavía no tiene documentos, ni en sus negociaciones ni sueltos.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-6">
      <div className="flex items-center gap-2 mb-5">
        <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
          <FolderOpen className="h-4 w-4" strokeWidth={2} />
        </div>
        <div>
          <h2 className="font-display text-lg font-black">Documentos</h2>
          <p className="text-[11px] text-neutral-500">{pdFiles.total} archivo{pdFiles.total !== 1 ? "s" : ""} · click para ver, descarga desde el visor</p>
        </div>

        {/* Mismo conmutador que el Drive (`DriveBrowser.tsx`), a proposito: es la misma decision
            —"lista o cuadricula"— y quien la aprende en una pantalla la reconoce en la otra. */}
        <div className="ml-auto flex items-center bg-neutral-100 rounded-xl p-0.5 shrink-0">
          <button
            onClick={() => cambiarVista("list")}
            aria-pressed={vista === "list"}
            className={cn("h-8 w-8 rounded-lg flex items-center justify-center transition", vista === "list" ? "bg-white shadow text-neutral-900" : "text-neutral-500 hover:text-neutral-700")}
            title="Lista"
          >
            <List className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
          <button
            onClick={() => cambiarVista("grid")}
            aria-pressed={vista === "grid"}
            className={cn("h-8 w-8 rounded-lg flex items-center justify-center transition", vista === "grid" ? "bg-white shadow text-neutral-900" : "text-neutral-500 hover:text-neutral-700")}
            title="Galeria de miniaturas"
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
        </div>
      </div>


      {/* ── LISTA ───────────────────────────────────────────────────────────────────────────
          La de siempre, con el mismo aspecto. Lo unico que cambio es DE DONDE saca los archivos:
          ahora del recorrido compartido, para que su orden y el de las flechas sean el mismo por
          construccion y no por coincidencia. */}
      {vista === "list" ? (
        <div className="space-y-3">
          {documentos.grupos.map((grupo) => {
            const open = openFolders[grupo.folderId] !== false;
            return (
              <div key={grupo.folderId} className="rounded-xl border border-neutral-100 overflow-hidden">
                <button
                  onClick={() => setOpenFolders({ ...openFolders, [grupo.folderId]: !open })}
                  className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50 hover:bg-neutral-100 transition text-left"
                >
                  <div className="flex items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
                    <FolderOpen className="h-4 w-4 text-purple-600" strokeWidth={1.5} />
                    <span className="font-ui font-bold text-[12px] uppercase tracking-wider">{grupo.folderNombre}</span>
                    <span className="text-[10px] text-neutral-400 ml-1">{grupo.archivos.length} archivo{grupo.archivos.length !== 1 ? "s" : ""}</span>
                  </div>
                </button>
                {open && (
                  <ul className="divide-y divide-neutral-100">
                    {grupo.archivos.map(({ file, indice }) => {
                      const sizeKB = file.size_bytes ? Math.round(Number(file.size_bytes) / 1024) : null;
                      const sizeStr = sizeKB == null ? "" : sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
                      return (
                        <li key={file.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50 transition">
                          <button
                            onClick={() => onPreview(indice)}
                            className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          >
                            {/* Antes: un icono FIJO —una hoja o una foto— que no decia nada del
                                contenido. Ahora la misma miniatura que la galeria, con su carga
                                perezosa: la lista de una ficha con 41 documentos no pide 41
                                imagenes de golpe, solo las que entran en pantalla. Un `.docx`
                                sigue saliendo con su icono de color, que es la respuesta correcta. */}
                            <div className="relative h-9 w-9 rounded-lg overflow-hidden bg-neutral-100 shrink-0">
                              <MiniaturaArchivo file={file} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-[13px] text-neutral-800 hover:text-purple-600 transition truncate">{file.nombre}</div>
                              <div className="text-[10px] text-neutral-400 flex gap-2">
                                {sizeStr && <span>{sizeStr}</span>}
                                {file.created_at && <span>· {new Date(file.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                              </div>
                            </div>
                          </button>
                          <a
                            href={`/api/drive/files/${file.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="h-8 w-8 rounded-lg hover:bg-purple-100 text-neutral-400 hover:text-purple-600 flex items-center justify-center transition"
                            title="Descargar"
                          >
                            <Download className="h-4 w-4" strokeWidth={2} />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}

          {/* Las negociaciones que todavía no tienen ningún documento.
              🔴 Se enseñan, y no se omiten: «que no salga» se lee como que esa negociación no
              existe, y quien la busca acaba en el Drive dando vueltas. Van APARTE del recorrido
              —no son un grupo plegable— porque un grupo vacío sería un hueco donde la flecha del
              visor se pararía. Ver `lib/documentos-contacto.ts`. */}
          {documentos.vacios.length > 0 && (
            <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-3">
              <div className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                Sin documentos todavía
              </div>
              <ul className="space-y-1">
                {documentos.vacios.map((v) => (
                  <li key={v.folderId} className="flex items-center gap-2 text-[12px] text-neutral-400">
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    <span className="truncate">{v.folderNombre}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        /* ── GALERIA ──────────────────────────────────────────────────────────────────────
           SIN agrupar por carpeta a proposito: la galeria existe para reconocer un documento de
           un vistazo, y partirla en secciones plegables devolveria el problema que resuelve. La
           carpeta de cada archivo sigue estando en la lista, que es la vista para ubicarlo.
           El orden es el mismo del recorrido, asi que las flechas del visor van en el orden en
           que se ven las tarjetas. */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {documentos.planos.map(({ file, indice }) => (
            <FileThumbCard
              key={file.id}
              file={file}
              onPreview={() => onPreview(indice)}
              onDownload={() => window.open(`/api/drive/files/${file.id}/download`, "_blank", "noopener,noreferrer")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotasTab({ contactoId }: { contactoId: string }) {
  const [data, setData] = useState<any | null>(null);
  const [texto, setTexto] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState("");
  const [editArchivos, setEditArchivos] = useState<NotaArchivoT[]>([]); // adjuntos existentes que se conservan
  const [editNuevos, setEditNuevos] = useState<File[]>([]);             // adjuntos nuevos a subir
  const [savingEdit, setSavingEdit] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  const load = () => fetch(`/api/contactos/${contactoId}/notas`).then((r) => r.json()).then(setData).catch(() => setData({ notes: [], total: 0 }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [contactoId]);

  const addFiles = (incoming: File[]) => setPendingFiles((prev) => [...prev, ...incoming]);
  const addEditNuevos = (incoming: File[]) => { if (incoming.length) setEditNuevos((prev) => [...prev, ...incoming]); };
  const { isOver, dropProps } = useFileDrop(addFiles, { disabled: saving });

  // Pegar fotos/archivos desde el portapapeles (Ctrl/Cmd+V) directo en la nota.
  const pastedFiles = (e: React.ClipboardEvent<HTMLTextAreaElement>): File[] => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return [];
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (!f) continue;
        if (!f.name || /^(image|blob)\.?\w*$/i.test(f.name)) {
          const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          pasted.push(new File([f], `captura-${stamp}.${ext}`, { type: f.type, lastModified: Date.now() }));
        } else {
          pasted.push(f);
        }
      }
    }
    return pasted;
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedFiles(e);
    if (pasted.length > 0) { e.preventDefault(); addFiles(pasted); toast.success(pasted.length === 1 ? "Adjunto pegado" : `${pasted.length} adjuntos pegados`); }
  };
  const onEditPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = pastedFiles(e);
    if (pasted.length > 0) { e.preventDefault(); addEditNuevos(pasted); toast.success(pasted.length === 1 ? "Adjunto pegado" : `${pasted.length} adjuntos pegados`); }
  };

  const add = async () => {
    const t = texto.trim();
    if (!t && pendingFiles.length === 0) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (t) fd.append("contenido", t);
      pendingFiles.forEach((f) => fd.append("archivo", f));
      const r = await fetch(`/api/contactos/${contactoId}/notas`, { method: "POST", body: fd });
      if (!r.ok) throw new Error();
      toast.success("Nota agregada"); setTexto(""); setPendingFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch { toast.error("No se pudo guardar la nota"); } finally { setSaving(false); }
  };
  const startEdit = (n: any) => {
    setEditId(n.id);
    setEditTexto(String(n.contenido || ""));
    setEditArchivos(Array.isArray(n.archivos) ? n.archivos : []);
    setEditNuevos([]);
  };
  const cancelEdit = () => {
    setEditId(null); setEditTexto(""); setEditArchivos([]); setEditNuevos([]);
    if (editFileRef.current) editFileRef.current.value = "";
  };
  const saveEdit = async (id: string) => {
    const t = editTexto.trim();
    if (!t && editArchivos.length === 0 && editNuevos.length === 0) { toast.error("La nota no puede quedar vacía"); return; }
    setSavingEdit(true);
    try {
      const fd = new FormData();
      fd.append("contenido", t);
      fd.append("archivos_keep", JSON.stringify(editArchivos));
      editNuevos.forEach((f) => fd.append("archivo", f));
      const r = await fetch(`/api/contactos/${contactoId}/notas/${id}`, { method: "PATCH", body: fd });
      if (!r.ok) throw new Error();
      toast.success("Nota actualizada"); cancelEdit(); load();
    } catch { toast.error("No se pudo editar"); } finally { setSavingEdit(false); }
  };
  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta nota?")) return;
    try {
      const r = await fetch(`/api/contactos/${contactoId}/notas/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      toast.success("Nota eliminada"); load();
    } catch { toast.error("No se pudo eliminar"); }
  };

  const notes: any[] = data?.notes || [];
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center">
          <StickyNote className="h-4 w-4" strokeWidth={2} />
        </div>
        <div>
          <h2 className="font-display text-lg font-black">Notas</h2>
          <p className="text-[11px] text-neutral-500">{notes.length} nota{notes.length !== 1 ? "s" : ""} · se guardan en el CRM (siempre disponibles)</p>
        </div>
      </div>

      {/* Composer — agregar nota con texto y/o archivos e imágenes (arrastra o usa el clip) */}
      <div {...dropProps} className={cn("relative mb-5 rounded-xl border transition", isOver ? "border-brand-orange ring-4 ring-brand-orange/15 bg-brand-orange/5" : "border-neutral-200 focus-within:ring-4 focus-within:ring-brand-orange/15 focus-within:border-brand-orange")}>
        {isOver && (
          <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-brand-orange bg-white/70 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 text-brand-orange font-ui font-bold text-sm"><Paperclip className="h-4 w-4" strokeWidth={2.5} /> Suelta los archivos aquí</div>
          </div>
        )}
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); }}
          onPaste={onPaste}
          placeholder="Escribe una nota… adjunta o pega archivos/imágenes (Cmd/Ctrl+Enter para guardar)"
          className="w-full px-3 py-2 text-sm outline-none resize-none bg-transparent rounded-t-xl"
        />
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center px-3 pb-1">
            {pendingFiles.map((f, i) => (
              <NewFileChip key={f.name + "_" + f.size + "_" + i} file={f} onRemove={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))} />
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files || [])); if (fileRef.current) fileRef.current.value = ""; }} />
        <div className="flex items-center justify-between px-2 pb-2">
          <button onClick={() => fileRef.current?.click()} title="Adjuntar archivos o imágenes" className="h-9 w-9 rounded-xl hover:bg-neutral-100 text-neutral-500 flex items-center justify-center transition">
            <Paperclip className="h-4 w-4" strokeWidth={2} />
          </button>
          <button onClick={add} disabled={saving || (!texto.trim() && pendingFiles.length === 0)} className="gradient-orange h-9 px-4 rounded-xl text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-glow disabled:opacity-60 inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />} Añadir nota
          </button>
        </div>
      </div>

      {data === null ? (
        <div className="py-6 text-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
      ) : notes.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">Aún no hay notas. Escribe la primera arriba.</div>
      ) : (
        <ul className="space-y-3">
          {notes.map((n: any) => {
            const isLocal = n.source === "local";
            const body = String(n.contenido || "");
            const rest = body;
            return (
              <li key={`${n.source}-${n.id}`} className="rounded-xl border border-neutral-100 p-4 group">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {isLocal && <span className="px-1.5 py-0.5 rounded-md bg-brand-orange/10 text-brand-orange text-[9px] font-ui font-bold uppercase tracking-wider shrink-0">CRM{n.user_nombre ? ` · ${n.user_nombre}` : ""}</span>}
                  {n.created_at && <span className="ml-auto text-[10px] text-neutral-400 shrink-0">{new Date(n.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                  {isLocal && n.can_edit && editId !== n.id && (
                    <span className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                      <button onClick={() => startEdit(n)} title="Editar" className="text-neutral-400 hover:text-brand-orange"><Edit3 className="h-3.5 w-3.5" /></button>
                      <button onClick={() => del(n.id)} title="Eliminar" className="text-neutral-400 hover:text-brand-red"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  )}
                </div>
                {editId === n.id ? (
                  <div>
                    <textarea value={editTexto} onChange={(e) => setEditTexto(e.target.value)} rows={3} onPaste={onEditPaste} className="w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 outline-none focus:border-brand-orange resize-none" />
                    {(editArchivos.length > 0 || editNuevos.length > 0) && (
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        {editArchivos.map((a, i) => (
                          <ExistingArchivoChip key={"ex" + i} archivo={a} onRemove={() => setEditArchivos((prev) => prev.filter((_, x) => x !== i))} onPreview={() => window.open(a.url, "_blank")} />
                        ))}
                        {editNuevos.map((f, i) => (
                          <NewFileChip key={"nv" + f.name + f.size + i} file={f} onRemove={() => setEditNuevos((prev) => prev.filter((_, x) => x !== i))} />
                        ))}
                      </div>
                    )}
                    <input ref={editFileRef} type="file" multiple className="hidden" onChange={(e) => { addEditNuevos(Array.from(e.target.files || [])); if (editFileRef.current) editFileRef.current.value = ""; }} />
                    <div className="flex gap-2 mt-1.5 items-center">
                      <button onClick={() => saveEdit(n.id)} disabled={savingEdit || (!editTexto.trim() && editArchivos.length === 0 && editNuevos.length === 0)} className="gradient-orange h-8 px-3 rounded-lg text-white text-[11px] font-ui font-bold uppercase inline-flex items-center gap-1 disabled:opacity-60">
                        {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Guardar
                      </button>
                      <button type="button" onClick={() => editFileRef.current?.click()} title="Adjuntar imágenes o archivos" className="h-8 w-8 rounded-lg border border-neutral-200 text-neutral-500 hover:text-brand-orange hover:border-brand-orange flex items-center justify-center"><Paperclip className="h-3.5 w-3.5" /></button>
                      <button onClick={cancelEdit} className="h-8 px-3 rounded-lg border border-neutral-200 text-neutral-500 text-[11px] font-ui font-bold uppercase">Cancelar</button>
                      <span className="text-[10px] text-neutral-400 ml-auto">pega con Ctrl+V</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[13px] text-neutral-700 whitespace-pre-wrap break-words">{rest}</div>
                )}
                {editId !== n.id && Array.isArray(n.archivos) && n.archivos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {n.archivos.map((a: any, ai: number) => {
                      const isImg = (a.mime || "").startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.filename || "");
                      return isImg ? (
                        <a key={ai} href={a.url} target="_blank" rel="noopener noreferrer" title={a.filename} className="block h-20 w-20 rounded-lg overflow-hidden border border-neutral-200 hover:border-brand-orange transition">
                          <img src={a.url} alt={a.filename} className="h-full w-full object-cover" />
                        </a>
                      ) : (
                        <a key={ai} href={a.url} target="_blank" rel="noopener noreferrer" download={a.filename} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200 text-[12px] text-neutral-700 hover:border-brand-orange transition">
                          <FileText className="h-3.5 w-3.5 text-neutral-400 shrink-0" /> <span className="truncate max-w-[200px]">{a.filename}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Card({ icon: Icon, title, accent, actions, children, className }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("bg-white rounded-2xl border border-neutral-100 overflow-hidden", className)}>
      {accent && <div className="h-0.5" style={{ backgroundColor: accent }} />}
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-orange/10 text-brand-orange flex items-center justify-center">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </div>
            <h3 className="font-display font-black text-[15px]">{title}</h3>
          </div>
          {actions}
        </div>
        {children}
      </div>
    </motion.div>
  );
}

function Grid({ children }: any) { return <div className="grid grid-cols-2 gap-3">{children}</div>; }

function Label({ children, required }: any) {
  return <label className="text-[10px] font-ui uppercase tracking-[0.1em] text-neutral-500 block mb-1">{children}{required && <span className="text-brand-red ml-0.5">*</span>}</label>;
}

// `guardado`: la ficha NO trae el valor de este campo (credenciales USCIS / SSN), solo una bandera
// de que existe — las tres columnas siguen fuera de `COLS_DETALLE` y de `COLS_LISTA`. Sin nada que
// enseñar se indica que hay valor guardado, y si el usuario escribe uno nuevo, ese sí se envía.
// Dejarlo en blanco NO borra lo guardado (el PATCH solo toca las claves presentes en el body).
//
// Para VERLO hay que pedirlo aparte, al endpoint dedicado, que deja constancia de la consulta. Ese
// valor llega por `revelado` y no por `value`: ver abajo.
/**
 * `revelado` es el valor que devolvió el endpoint de datos sensibles. Llega APARTE de `value`
 * —que sale de `form`— y nunca se mezcla con él: `value` es lo que se guarda, `revelado` es lo que
 * se enseña. Si el usuario escribe encima, `value` pasa a estar definido y manda; si no toca nada,
 * `form` sigue sin el campo y el `save()` no lo devuelve al servidor.
 */
function Field({ label, value, revelado, onChange, editing, placeholder, icon: Icon, fullWidth, sensitive, required, guardado }: { label: string; value: any; revelado?: string | null; onChange: (v: string) => void; editing: boolean; placeholder?: string; icon?: any; fullWidth?: boolean; sensitive?: boolean; required?: boolean; guardado?: boolean }) {
  // Lo que hay que pintar: lo escrito en el formulario si lo hay, y si no, lo que se reveló.
  const valor = value != null ? value : (revelado ?? null);
  const show = valor != null && String(valor).length > 0;
  const soloGuardado = !!guardado && !show;
  const [revealed, setRevealed] = useState(false);
  const eyeBtn = sensitive ? (
    <button type="button" onClick={() => setRevealed((r) => !r)} title={revealed ? "Ocultar" : "Mostrar"} className="h-7 w-7 rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-400 shrink-0 transition-colors">
      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  ) : null;
  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <Label required={required}>{label}</Label>
      {editing ? (
        <div className="flex items-center gap-1">
          <div className="relative flex-1 min-w-0">
            {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" strokeWidth={1.8} />}
            <input value={valor || ""} type={sensitive && !revealed ? "password" : "text"} onChange={(e) => onChange(e.target.value)} placeholder={soloGuardado ? "Guardado — escribe para reemplazarlo" : (placeholder || "")} autoComplete={sensitive ? "new-password" : "off"} data-lpignore="true" data-1p-ignore="true" data-form-type="other" className={cn("w-full h-10 pr-3 rounded-xl bg-white border border-neutral-200 text-sm outline-none transition-all hover:border-neutral-300 focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange", Icon ? "pl-9" : "pl-3")} />
          </div>
          {!soloGuardado && eyeBtn}
        </div>
      ) : (
        <div className="h-10 flex items-center gap-2 text-sm text-neutral-800">
          <span className="min-w-0 break-all">
            {soloGuardado
              ? <span className="text-neutral-400">•••••••• <span className="text-[11px]">(guardado)</span></span>
              : show ? (sensitive && !revealed ? "••••••••" : valor) : <span className="text-neutral-300">—</span>}
          </span>
          {show && !soloGuardado && eyeBtn}
        </div>
      )}
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, editing, fullWidth }: { label: string; value: any; onChange: (v: string) => void; options: any[]; editing: boolean; fullWidth?: boolean }) {
  const selected = options.find((o: any) => o.value === value);
  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <Label>{label}</Label>
      {editing ? (
        <FancySelect value={value || ""} onChange={onChange} options={options} placeholder={`Sin ${label.toLowerCase()}`} />
      ) : (
        <div className="h-10 flex items-center text-sm text-neutral-800 gap-2">
          {selected?.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selected.color }} />}
          {selected?.label || <span className="text-neutral-300">—</span>}
        </div>
      )}
    </div>
  );
}

/**
 * Un campo de fecha. `sufijo` es OPCIONAL y se pinta a la derecha de la fecha, dentro del mismo
 * hueco de la rejilla, en gris y un punto mas pequenio.
 *
 * ⚠️ Lo que dice el sufijo lo calcula QUIEN LLAMA, no este componente. Meter aqui la edad
 * acoplaria un campo de fecha generico a un significado que solo tiene la fecha de nacimiento.
 *
 * En edicion no se pinta: mientras se teclea una fecha, un numero que va saltando distrae, y
 * ademas es basura hasta que la fecha esta completa.
 */
function FieldDate({ label, value, onChange, editing, fullWidth, sufijo }: { label: string; value: any; onChange: (v: string) => void; editing: boolean; fullWidth?: boolean; sufijo?: string | null }) {
  const display = value ? fmtFechaSolo(value) : null;
  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <Label>{label}</Label>
      {editing ? <DateField value={value ? String(value).slice(0, 10) : ""} onChange={onChange} size="sm" typeable /> : (
        <div className="h-10 flex items-center text-sm text-neutral-800">
          {display || <span className="text-neutral-300">—</span>}
          {display && sufijo && <span className="ml-1.5 text-xs text-neutral-400">· {sufijo}</span>}
        </div>
      )}
    </div>
  );
}

/** El valor de la opción "un agente que no es del equipo". No es un uuid: no puede chocar con uno. */
const AGENTE_OTRO = "__otro__";

export interface AgenteOfrecido { id: string; nombre: string }

/**
 * El agente de seguro de salud del contacto.
 *
 * 🔴 SOLO SE PINTA SI EL CONTACTO TIENE SEGURO. Quien lo llama decide eso; aqui se asume. Un
 * contacto "sin seguro" con agente asignado es el estado contradictorio que ensuciaria justo la
 * segmentacion para la que se pidio el campo: al agrupar por agente saldria gente sin seguro.
 *
 * Son DOS columnas excluyentes —una persona del equipo, o un nombre escrito a mano— y aqui se
 * ven como un solo control: elegir persona limpia el texto, elegir "Otro" limpia el id.
 *
 * 🔴 LOS AGENTES LLEGAN DEL SERVIDOR, YA RESUELTOS. Aqui no hay ni un uuid escrito, y el motivo no
 * es de estilo: staging y produccion son bases distintas y esas dos personas tienen id diferente
 * en cada una. Un uuid en el codigo funcionaria en un entorno y en el otro guardaria "sin agente"
 * sin decir nada. El servidor los resuelve por email, que si es estable
 * (`lib/contactos-agente-seguro.ts`).
 *
 * 🔴 NUNCA SE ENSENIA UN UUID (§4.7). Si el agente guardado ya no esta activo, se dice QUE PASA
 * —"ya no esta disponible"— con su nombre si lo sabemos.
 */
function FieldAgenteSeguro({ contacto, form, setForm, editing, agentes }: {
  contacto: any;
  form: any;
  setForm: (f: any) => void;
  editing: boolean;
  agentes: AgenteOfrecido[];
}) {
  const idActual: string | null = form.agente_seguro_id ?? null;
  const otroActual: string = form.agente_seguro_otro ?? "";
  const esOtro = !idActual && form.agente_seguro_otro != null;

  const elegir = (valor: string) => {
    if (valor === AGENTE_OTRO) setForm({ ...form, agente_seguro_id: null, agente_seguro_otro: otroActual || "" });
    else setForm({ ...form, agente_seguro_id: valor, agente_seguro_otro: null });
  };

  // ── SOLO LECTURA ──
  if (!editing) {
    const nombre = contacto.agente_seguro_nombre || null;
    const inactivo = !!contacto.agente_seguro_id && contacto.agente_seguro_activo === false;
    return (
      <div className="col-start-2">
        <Label>Agente de seguro de salud</Label>
        <div className="h-10 flex items-center text-sm text-neutral-800 gap-2">
          {contacto.agente_seguro_id ? (
            inactivo ? (
              <span className="text-amber-700">
                {nombre || "El agente asignado"} <span className="text-neutral-500">— ya no esta disponible</span>
              </span>
            ) : (nombre || <span className="text-neutral-400 italic">agente del equipo</span>)
          ) : contacto.agente_seguro_otro ? (
            <span>{contacto.agente_seguro_otro} <span className="text-[10px] text-neutral-400 font-ui uppercase tracking-wider">externo</span></span>
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </div>
      </div>
    );
  }

  // ── EDICION ──
  // 🔴 `col-start-2` lo fuerza a la MISMA columna que "Tiene seguro de salud", justo debajo. Sin
  // esto la rejilla lo coloca en la izquierda y la pregunta y su respuesta quedan en diagonal, que
  // es lo que se veia feo y despistaba. El hueco que queda a su izquierda es el precio, y es
  // barato: cuando el campo no se pinta —"Tiene seguro" en No— no hay hueco ninguno y
  // "Responsable" vuelve a fluir donde siempre.
  return (
    <div className="col-start-2">
      <Label>Agente de seguro de salud</Label>

      {/* 🔴 SE PUEDE QUEDAR SIN NINGUNO, y hace falta: con radios bastaba no marcar, pero un
          segmented control siempre tiene uno activo. Por eso `SegmentedControl` deselecciona al
          pulsar el que ya esta marcado — si no, asignar un agente por error seria irreversible
          (§2.8: todo sitio que concede algo tiene que tener como cambiarlo).
          «Sin agente» no es un estado degradado: es el de casi toda la cartera. */}
      <SegmentedControl
        ariaLabel="Agente de seguro de salud"
        valor={idActual ?? (esOtro ? AGENTE_OTRO : null)}
        onChange={(v) => (v === null ? setForm({ ...form, agente_seguro_id: null, agente_seguro_otro: null }) : elegir(v))}
        tituloDeseleccion="Pulsa otra vez para dejarlo sin agente"
        className="mt-0.5"
        opciones={[
          // El nombre se parte en dos lineas —pila arriba, apellido debajo— con la misma funcion
          // que usa el encabezado. «Otro» no tiene apellido, y el componente le reserva el hueco
          // igual para que los tres segmentos midan lo mismo.
          ...agentes.map((a) => ({ valor: a.id, ...nombreEnDosLineas(a.nombre) })),
          { valor: AGENTE_OTRO, titulo: "Otro" },
        ]}
      />

      {esOtro && (
        <input
          value={otroActual}
          onChange={(e) => setForm({ ...form, agente_seguro_id: null, agente_seguro_otro: e.target.value })}
          placeholder="Nombre del agente"
          className="mt-2 w-full h-10 px-3 rounded-xl bg-neutral-50 border border-neutral-200 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-brand-orange/30"
        />
      )}

      {/* El agente guardado puede no estar entre las opciones: o se dio de baja, o es alguien de
          antes de que la lista se acotara a dos. No se borra ni se esconde —el dato es real— pero
          se dice, para que nadie crea que el campo esta vacio. */}
      {!!contacto.agente_seguro_id && !agentes.some((a) => a.id === contacto.agente_seguro_id) && (
        <p className="mt-2 text-[11px] text-amber-700">
          El agente que tiene asignado ({contacto.agente_seguro_nombre || "otra persona del equipo"})
          ya no esta entre las opciones. Se conserva hasta que elijas otro.
        </p>
      )}
    </div>
  );
}

function FieldBool({ label, value, onChange, editing, icon: Icon, fullWidth }: { label: string; value: any; onChange: (v: boolean) => void; editing: boolean; icon?: any; fullWidth?: boolean }) {
  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <Label>{label}</Label>
      {editing ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onChange(true)} className={cn("flex-1 h-10 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition", value === true ? "bg-brand-green text-white" : "bg-white border border-neutral-200 text-neutral-500")}>Sí</button>
          <button type="button" onClick={() => onChange(false)} className={cn("flex-1 h-10 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition", value === false ? "bg-brand-red text-white" : "bg-white border border-neutral-200 text-neutral-500")}>No</button>
        </div>
      ) : (
        <div className="h-10 flex items-center gap-2 text-sm">
          {Icon && <Icon className="h-3.5 w-3.5 text-neutral-400" strokeWidth={1.8} />}
          {value === true ? <span className="text-brand-green font-semibold">Sí</span> : value === false ? <span className="text-brand-red font-semibold">No</span> : <span className="text-neutral-300">—</span>}
        </div>
      )}
    </div>
  );
}

/**
 * El responsable del contacto. Solo lectura: se asigna desde la acción masiva del listado, y tener
 * dos sitios que escriben lo mismo es de donde salen las divergencias.
 *
 * Cuando no hay, se dice — no se deja el hueco en blanco. Un contacto sin responsable es un dato,
 * no la ausencia de uno: son justo los que hay que repartir.
 */
function FieldResponsable({ nombre, id }: { nombre?: string | null; id?: string | null }) {
  return (
    <div>
      <Label>Responsable</Label>
      <div className="h-10 flex items-center text-sm">
        {nombre ? (
          <a
            href={`/contactos?responsable=${id}`}
            className="font-semibold text-brand-orange hover:underline"
            title="Ver todos los contactos de esta persona"
          >
            {nombre}
          </a>
        ) : (
          <span className="text-neutral-400 italic">sin responsable asignado</span>
        )}
      </div>
    </div>
  );
}

function FieldStat({ label, value, color }: any) {
  return <div><Label>{label}</Label><div className="h-10 flex items-center text-xl font-black font-display tabular-nums" style={{ color }}>{value}</div></div>;
}

function FieldReferidoPor({ value, refNombre, onChange, editing }: { value: any; refNombre?: string; onChange: (v: string | null) => void; editing: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  useEffect(() => {
    if (!editing || !q || q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => { fetch(`/api/contactos/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => setResults(d.contactos || [])); }, 200);
    return () => clearTimeout(t);
  }, [q, editing]);

  return (
    <div className="col-span-2">
      <Label>Referido por</Label>
      {editing ? (
        <div className="relative">
          <input value={q || refNombre || ""} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto..." className="w-full h-10 px-3 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange" />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-neutral-200 shadow-xl z-10 max-h-60 overflow-y-auto">
              {results.map((r) => (
                <button key={r.id} type="button" onClick={() => { onChange(r.id); setQ(""); setResults([]); }} className="w-full px-3 py-2 text-left hover:bg-neutral-50 text-sm border-b border-neutral-50 last:border-0">
                  <div className="font-semibold">{r.nombre_completo}</div>
                  <div className="text-[10px] text-neutral-500">{r.email || r.telefono} · {r.tipo_cliente}</div>
                </button>
              ))}
            </div>
          )}
          {value && (
            <div className="mt-1.5 text-[11px] text-neutral-500 flex items-center gap-1">
              Seleccionado: <strong>{refNombre}</strong>
              <button onClick={() => { onChange(null); setQ(""); }} className="ml-1 h-4 w-4 rounded hover:bg-neutral-100 flex items-center justify-center"><X className="h-3 w-3" /></button>
            </div>
          )}
        </div>
      ) : <div className="h-10 flex items-center text-sm text-neutral-800">{refNombre || <span className="text-neutral-300">—</span>}</div>}
    </div>
  );
}

function NegociacionesList({ abiertas, cerradas }: any) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-neutral-100 p-5">
        <h3 className="font-display font-black text-[15px] mb-3 flex items-center gap-2"><DollarSign className="h-4 w-4 text-brand-orange" /> Abiertas <span className="text-[11px] font-normal text-neutral-400">({abiertas.length})</span></h3>
        {abiertas.length === 0 ? <div className="text-center py-6 text-[12px] text-neutral-400">Sin negociaciones abiertas</div> : <div className="space-y-1.5">{abiertas.map((o: any) => <OportunidadRow key={o.id} o={o} />)}</div>}
      </div>
      <div className="bg-white rounded-2xl border border-neutral-100 p-5">
        <h3 className="font-display font-black text-[15px] mb-3 flex items-center gap-2"><CheckSquare className="h-4 w-4 text-brand-green" /> Cerradas <span className="text-[11px] font-normal text-neutral-400">({cerradas.length})</span></h3>
        {cerradas.length === 0 ? <div className="text-center py-6 text-[12px] text-neutral-400">Sin negociaciones cerradas</div> : <div className="space-y-1.5">{cerradas.map((o: any) => <OportunidadRow key={o.id} o={o} />)}</div>}
      </div>
    </div>
  );
}

function OportunidadRow({ o }: any) {
  return (
    <a href={`/oportunidades/${o.id}`} className="block bg-neutral-50/60 hover:bg-neutral-50 rounded-xl px-4 py-3 border border-neutral-100 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-sm truncate">{o.nombre_caso}</span>
            {o.tramite_nombre && <span className="text-[10px] bg-white px-1.5 py-0.5 rounded-md text-neutral-500">{o.formulario_uscis || o.tramite_nombre}</span>}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            {o.preparador_nombre && `${o.preparador_nombre} · `}{o.etapa}
            {o.fecha_completada && ` · completada ${new Date(o.fecha_completada).toLocaleDateString("es")}`}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold tabular-nums">${Number(o.valor_total || 0).toFixed(0)}</div>
          {Number(o.balance_pendiente || 0) > 0 && <div className="text-[10px] text-brand-red">pend ${Number(o.balance_pendiente).toFixed(0)}</div>}
        </div>
        <ArrowUpRight className="h-4 w-4 text-neutral-300 shrink-0" />
      </div>
    </a>
  );
}

function TareasList({ tareas, contactoId, contactoNombre, onReload }: any) {
  const [titulo, setTitulo] = useState("");
  const [creating, setCreating] = useState(false);
  // El modal completo, el MISMO del módulo de Tareas. Con `tareaId` abre una existente; sin él,
  // crea una nueva con el contacto ya fijado.
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tareaAbierta, setTareaAbierta] = useState<string | null>(null);

  const abrir = (id: string | null) => { setTareaAbierta(id); setModalAbierto(true); };

  const add = async () => {
    if (!titulo.trim()) return;
    setCreating(true);
    try {
      const r = await fetch("/api/tareas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo: titulo.trim(), contacto_id: contactoId, prioridad: "normal" }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(typeof d?.error === "string" ? d.error : "Error");
      }
      toast.success("Tarea creada");
      setTitulo("");
      onReload();
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-5">
      {/*
        Dos caminos a propósito: el de una línea para «llamar el martes», y el completo para todo
        lo demás —descripción, plazo, responsable, observadores, adjuntos y el chat de la tarea—.
        El completo NO es un formulario nuevo: es el del módulo de Tareas con el cliente fijado, y
        por eso no puede divergir de él.
      */}
      <div className="flex items-center gap-2 mb-4">
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Nueva tarea rápida del contacto..." className="flex-1 h-10 px-4 rounded-xl bg-white border border-neutral-200 text-sm outline-none focus:ring-4 focus:ring-brand-orange/15 focus:border-brand-orange" />
        <button onClick={add} disabled={creating || !titulo.trim()} className="gradient-orange h-10 px-4 rounded-xl text-white font-ui text-[11px] font-bold uppercase tracking-wider shadow-glow disabled:opacity-60 flex items-center gap-1.5">
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" />}
          Añadir
        </button>
        <button onClick={() => abrir(null)} className="h-10 px-4 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange/15 transition-colors flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
          Tarea con detalle
        </button>
      </div>

      {/* Esta lista solo enseña las abiertas. Para ver también las completadas y las canceladas
          está el módulo, ya filtrado por este cliente. */}
      <div className="-mt-2 mb-4">
        <a
          href={`/tareas?contacto=${contactoId}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
          Ver todas en el módulo de tareas
        </a>
      </div>

      <TaskModal
        open={modalAbierto}
        tareaId={tareaAbierta}
        contactoLock={{ id: contactoId, nombre: contactoNombre }}
        onClose={() => { setModalAbierto(false); setTareaAbierta(null); }}
        onSaved={() => onReload()}
      />
      {tareas.length === 0 ? (
        <div className="text-center py-10 text-neutral-400">
          <CheckSquare className="h-8 w-8 mx-auto mb-2 text-brand-orange" strokeWidth={1.5} />
          <p className="text-sm">Sin tareas para este contacto</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tareas.map((t: any) => (
            <button
              key={t.id}
              type="button"
              onClick={() => abrir(t.id)}
              className={cn("w-full text-left bg-neutral-50/60 hover:bg-neutral-50 rounded-xl px-4 py-3 border border-neutral-100 transition-colors", t.estado === "completada" && "opacity-60")}
            >
              <div className="flex items-center gap-3">
                <CheckSquare className={cn("h-4 w-4 shrink-0", t.estado === "completada" ? "text-brand-green" : "text-neutral-300")} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-semibold truncate", t.estado === "completada" && "line-through text-neutral-400")}>{t.titulo}</div>
                  <div className="text-[11px] text-neutral-500 flex items-center gap-2 flex-wrap mt-0.5">
                    {t.responsable_nombre && <span>{t.responsable_nombre}</span>}
                    {t.fecha_limite && <span>· vence {new Date(t.fecha_limite).toLocaleDateString("es")}</span>}
                    {t.nombre_caso && <span className="text-brand-blue">· {t.nombre_caso}</span>}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-neutral-300 shrink-0" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferidosList({ referidos, onNav }: any) {
  if (referidos.length === 0) return <div className="bg-white rounded-2xl border border-neutral-100 p-16 text-center"><UsersIcon className="h-10 w-10 text-brand-orange mx-auto mb-3" strokeWidth={1.5} /><p className="text-neutral-500 text-sm">No ha referido a nadie todavía</p></div>;
  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-5">
      <div className="space-y-1.5">
        {referidos.map((r: any) => (
          <button key={r.id} onClick={() => onNav(r.id)} className="w-full bg-neutral-50/60 hover:bg-neutral-50 rounded-xl px-4 py-3 border border-neutral-100 flex items-center gap-3 text-left">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              {(r.nombre_completo || "??").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{r.nombre_completo}</div>
              <div className="text-[11px] text-neutral-500">{r.email || r.telefono} · {r.tipo_cliente}</div>
            </div>
            <span className="text-[10px] text-neutral-400">{new Date(r.created_at).toLocaleDateString("es")}</span>
            <ArrowUpRight className="h-4 w-4 text-neutral-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
