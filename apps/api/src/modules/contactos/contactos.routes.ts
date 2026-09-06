import type { Express, Request, Response } from "express";
import type { ContactoDetalle } from "@gozz/shared-types";
import { z } from "zod";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { query } from "../../shared/db.js";
import { requireAuth } from "../../shared/auth-middleware.js";
import { emitToUser } from "../../shared/socket.js";
import { recomputeBalance } from "../../lib/oportunidad-balance.js";
import { placeUploadedFile } from "../../lib/storage.js";
import { deleteUploadsIfUnreferenced } from "../../lib/uploads-cleanup.js";
import { archivarContactos, desarchivarContactos, contarImpacto, comprobarDesarchivado } from "../../lib/contactos-archivado.js";
import { SIN_USUARIO, autoresDePapelera, contarArchivadosSinFecha, listarPapelera, sqlFiltrosPapelera } from "../../lib/contactos-papelera.js";
import { fusionar, revertir, columnasEnriquecibles, sugerirMaestro, CAMPOS_NO_ELEGIBLES_POR_SENSIBLES, MOTIVO_SENSIBLE, MOTIVO_FUSION_INTERFAZ } from "../../lib/contactos-merge.js";
import { analizarParecidoNombres, sqlDuplicadosRevisables } from "../../lib/contactos-dedup.js";
import { MAX_TAREAS_POR_OPERACION, asignarResponsable, crearTareasParaContactos, leerResponsableId, validarResponsableAsignable } from "../../lib/contactos-acciones.js";
import { esAdminEnBase, esUsuarioActivo } from "../../lib/permisos.js";
import { leerDatosSensibles } from "../../lib/contactos-sensibles.js";
import { normalizarFechaNacimiento, queFaltaParaElAlta } from "../../lib/contactos-alta.js";
import { listarAgentesSeguro, pierdeElSeguro, resolverAgenteSeguro } from "../../lib/contactos-agente-seguro.js";
import { parsearSeleccion, type Seleccion } from "../../lib/seleccion.js";
import { NO_ARCHIVADOS, construirFiltroContactos, leerFiltros, type FiltrosContactos } from "../../lib/contactos-filtro.js";

function isAdmin(u: any) { return u?.nivel === "super_admin" || u?.nivel === "admin"; }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Subida de adjuntos para notas de contacto (mismo dir local servido en /uploads).
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/root/gozz-crm/data/uploads";
const notasUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${file.originalname.replace(/[^\w.\-]+/g, "_")}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ==================== Schemas ====================
const ContactoFullSchema = z.object({
  // Info personal
  nombre_completo: z.string().min(2).optional(),
  nombre: z.string().nullable().optional(),
  apellido: z.string().nullable().optional(),
  segundo_nombre: z.string().nullable().optional(),
  fecha_nacimiento: z.string().nullable().optional(),
  estado_civil: z.enum(["soltero","casado","divorciado","viudo","union_libre","separado"]).nullable().optional(),
  genero: z.enum(["masculino","femenino","otro"]).nullable().optional(),
  idioma: z.string().nullable().optional(),
  tiene_seguro_salud: z.boolean().nullable().optional(),
  // El agente de seguro. Excluyentes entre si: la BASE lo impide con un CHECK (mig. 0070) y el
  // PATCH lo comprueba antes de escribir. Aqui solo se acepta la forma.
  agente_seguro_id: z.string().uuid().nullable().optional(),
  agente_seguro_otro: z.string().nullable().optional(),
  // `correo_personal` YA NO SE ACEPTA. Es columna historica desde la mig. 0071: sigue en la tabla
  // (§0, no se borra nada) pero la aplicacion no la lee ni la escribe. Al no estar en el esquema,
  // zod la descarta en silencio, que es justo lo que se quiere — no es un error del que llama, es
  // un campo retirado.
  email: z.string().email().nullable().optional().or(z.literal("")),
  telefono: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  // Migratorio
  estatus_migratorio: z.string().nullable().optional(),
  estatus_migratorio_tipo: z.enum(["ciudadano","residente","asilo_pendiente","permiso_trabajo","tps","daca","visa_u","visa_t","indocumentado","otros"]).nullable().optional(),
  estatus_migratorio_otros: z.string().nullable().optional(),
  ciudadano_tipo: z.enum(["naturalizado","nativo"]).nullable().optional(),
  a_number: z.string().nullable().optional(),
  itin: z.string().nullable().optional(),
  pasaporte_numero: z.string().nullable().optional(),
  pasaporte_pais: z.string().nullable().optional(),
  ssn_encrypted: z.string().nullable().optional(),
  // Dirección
  direccion_calle: z.string().nullable().optional(),
  direccion_linea2: z.string().nullable().optional(),
  direccion_ciudad: z.string().nullable().optional(),
  direccion_estado: z.string().nullable().optional(),
  direccion_cp: z.string().nullable().optional(),
  direccion_pais: z.string().nullable().optional(),
  recibe_correo_postal: z.boolean().nullable().optional(),
  // USCIS creds
  correo_uscis: z.string().nullable().optional(),
  usuario_uscis: z.string().nullable().optional(),
  clave_correo_uscis_enc: z.string().nullable().optional(),
  clave_uscis_enc: z.string().nullable().optional(),
  // Tipo cliente / referidos
  tipo_cliente: z.enum(["lead","referido","cliente"]).nullable().optional(),
  referido_por_contacto_id: z.string().uuid().nullable().optional(),
  saldo_referidos_usd: z.coerce.number().nullable().optional(),
  // Otros
  empleador_actual: z.string().nullable().optional(),
  notas_internas: z.string().nullable().optional(),
  etiquetas: z.array(z.string()).optional()
});

const DescuentoSchema = z.object({
  monto: z.number().positive().nullable().optional(),
  porcentaje: z.number().min(0).max(100).nullable().optional(),
  motivo: z.string().min(3),
  referido_contacto_id: z.string().uuid().nullable().optional()
}).refine((d) => d.monto || d.porcentaje, { message: "Debe especificar monto o porcentaje" });

// ==================== Helpers ====================
function buildNombreCompleto(d: any): string | null {
  if (d.nombre_completo) return d.nombre_completo;
  const parts = [d.nombre, d.segundo_nombre, d.apellido].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

// ============================================================================================
// 🔴 PROYECCIONES EXPLÍCITAS — NUNCA `SELECT *` SOBRE contactos_cache EN UNA RESPUESTA HTTP.
//
// La tabla guarda credenciales de la cuenta USCIS del cliente y su SSN. Pese al sufijo `_enc`,
// esas columnas NO están cifradas: se escriben en claro desde el formulario (el helper
// lib/crypto.ts existe pero NUNCA se llama en este archivo). Con `SELECT *` el listado mandaba
// esas columnas al navegador de CUALQUIER usuario autenticado, incluido nivel `usuario`.
//
// Regla: si añades una columna a contactos_cache, decide A PROPÓSITO si entra aquí. Que el
// default sea "no se expone" es justamente el punto de enumerarlas.
// ============================================================================================

/** Credenciales y datos de máxima sensibilidad. No salen de la API por ningún endpoint. */
const COLUMNAS_SECRETAS = ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"];

/**
 * LISTADO: EXACTAMENTE las columnas que pinta la pantalla de contactos (tarjetas y tabla). Sin
 * SSN, sin claves, sin ITIN, sin A-Number, sin pasaporte y sin los jsonb crudos.
 *
 * Se recortó al implementar la paginación: con 100 filas por página, devolver 34 columnas eran
 * ~100 KB por petición de los que la interfaz usaba menos de la mitad — y las más pesadas
 * (`etiquetas`, `updated_at`, `referido_por_contacto_id`…) no se muestran en
 * ningún sitio del listado. Ahora son ~43 KB (§3.6).
 *
 * Si una vista nueva necesita otra columna, se añade AQUÍ a propósito. Ese es el punto de
 * enumerarlas: lo que no está en esta lista no sale de la API (R11).
 */
/**
 * 🔴 EL CORREO DEL CONTACTO, RESUELTO EN UN SOLO SITIO.
 *
 * Habia DOS columnas para el mismo dato y cada pantalla decidia sola: el listado leia `email` a
 * secas, la ficha `correo_personal || email`, el boton de correo al reves y la negociacion un
 * COALESCE. Cuatro criterios, y el sintoma visible era que un contacto con solo `correo_personal`
 * **aparecia sin email en el listado**. Desde la mig. 0071 la unica fuente es `email`, y el
 * frontend solo lee esa clave.
 *
 * ⚠️ ENTONCES, ¿POR QUE SIGUE EL COALESCE AQUI? Por la VENTANA DE DESPLIEGUE. El codigo se
 * despliega solo y `pnpm migrate` lo corre un humano DESPUES, a mano: entre las dos cosas hay un
 * rato —minutos u horas— en el que esos 25 contactos todavia tienen el correo solo en la columna
 * vieja. Sin este COALESCE desaparecerian de la pantalla durante esa ventana, y el arreglo se
 * veria como una regresion justo el dia que se despliega.
 *
 * Se puede quitar cuando la 0071 este aplicada en los tres entornos. Mientras tanto, que este aqui
 * y en un solo sitio es lo que impide volver a tener cuatro criterios.
 */
const colEmail = (alias = "") => {
  const p = alias ? `${alias}.` : "";
  return `COALESCE(NULLIF(TRIM(${p}email), ''), NULLIF(TRIM(${p}correo_personal), '')) AS email`;
};

const COLS_LISTA = `
  id, nombre_completo,
  ${colEmail()}, telefono, whatsapp,
  tipo_cliente, estatus_migratorio, estatus_migratorio_tipo,
  revision_dedup_grupo,
  responsable_user_id,
  created_at`;

/**
 * El NOMBRE del responsable, para el listado.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ UNA SUBCONSULTA ESCALAR Y NO UN `JOIN`
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * La consulta del listado es `SELECT ${COLS_LISTA} FROM gozz.contactos_cache WHERE ${where}`
 * **sin alias**, y el WHERE que compone `construirFiltroContactos` nombra las columnas **sin
 * prefijar**. Meter `LEFT JOIN gozz.users` volvería ambiguos `id`, `nombre` y `activo`, y la
 * consulta reventaría.
 *
 * Arreglarlo con alias obligaría a prefijar el WHERE, y ese WHERE **es el mismo** que usan el
 * contador y `resolverSeleccion`, que consultan otras tablas y otras formas. Tocarlo para pintar
 * un nombre es mover la pieza de la que depende que "Seleccionar el total (N)" no mienta.
 *
 * La subconsulta escalar no toca nada de eso:
 *   · no hay alias que colisione, así que el WHERE se queda **exactamente como está**;
 *   · no puede cambiar el número de filas — un `JOIN` sí podría, y aquí eso descuadraría el
 *     contador contra la página;
 *   · se resuelve una vez por fila, y la página son 50 o 100 filas.
 *
 * MEDIDO con `EXPLAIN ANALYZE` sobre la base local (31.613 contactos, página de 100, caché
 * caliente, tres corridas):
 *
 *   sin la subconsulta ........................ 18,5 · 23,0 · 18,7 ms
 *   con ella .................................. 24,8 · 25,6 · 22,1 ms
 *   con ella y las 100 filas CON responsable .. 27,0 · 23,2 · 25,5 ms
 *
 * El `SubPlan` en sí cuesta **0,004 ms × 100 loops ≈ 0,4 ms**: la diferencia que se ve está dentro
 * del ruido de una consulta que ya hace `Seq Scan` sobre 31.613 filas. ⚠️ Y ese SubPlan es un
 * **`Seq Scan` sobre `users`, no un `Index Scan`** — con 16 usuarios, recorrer la tabla le sale más
 * barato a Postgres que ir por la PK, y hace bien. Si `users` creciera a miles, el planificador
 * cambiaría solo; no hay nada que ajustar por adelantado.
 */
const COL_RESPONSABLE_NOMBRE = `
  (SELECT u.nombre FROM gozz.users u WHERE u.id = contactos_cache.responsable_user_id) AS responsable_nombre`;

/**
 * DETALLE / ficha completa: todo MENOS las tres columnas secretas. Éstas se sustituyen por
 * banderas `tiene_*` para que la UI pueda decir "hay una clave guardada" sin recibir su valor.
 * (`archivado_at` / `archivado_por` de la 0056 no se listan todavía: la migración aún no está
 * aplicada y nombrarlas rompería la consulta.)
 */
const COLS_DETALLE = `
  id, nombre_completo, nombre, apellido, segundo_nombre,
  telefono, whatsapp,
  a_number, itin, pasaporte_numero, pasaporte_pais, pasaporte_expira,
  estatus_migratorio, estatus_migratorio_tipo, estatus_migratorio_otros, ciudadano_tipo,
  fecha_nacimiento, fecha_elegibilidad_medicare, estado_civil, genero, idioma,
  tiene_seguro_salud, empleador_actual, agente_seguro_id, agente_seguro_otro,
  direccion_calle, direccion_linea2, direccion_ciudad, direccion_estado, direccion_cp,
  direccion_pais, recibe_correo_postal, direcciones,
  correo_uscis, usuario_uscis,
  tipo_cliente, referido_por_contacto_id, saldo_referidos_usd,
  etiquetas, custom_fields, notas_internas,
  saneamiento_revision, saneamiento_motivo, saneamiento_aplicado_en,
  archivado, archivado_motivo, fusionado_en_contacto_id,
  revision_dedup, revision_dedup_grupo,
  responsable_user_id,
  created_at, updated_at`;

/** Antepone el alias de tabla a cada columna de una lista ("id, nombre" → "c.id, c.nombre"). */
const prefijar = (cols: string, alias: string) =>
  cols.split(",").map((s) => `${alias}.${s.trim()}`).join(", ");

/** Banderas de presencia de los secretos: la UI sabe que hay valor guardado, no cuál es. */
const flagsSecretos = (alias = "") => {
  const p = alias ? `${alias}.` : "";
  return COLUMNAS_SECRETAS
    .map((c) => `(${p}${c} IS NOT NULL AND ${p}${c} <> '') AS tiene_${c.replace(/_enc$|_encrypted$/, "")}`)
    .join(", ");
};


// ORDEN DEL LISTADO. `created_at` es INMUTABLE; `updated_at` NO sirve aquí aunque parezca más útil:
// contactos_cache tiene un trigger `trg_updated_at` que lo toca en CADA update (saneamiento,
// archivado…), así que las filas se reordenarían MIENTRAS el usuario pagina y volvería
// el problema que la paginación viene a resolver.
// El desempate por `id` NO es opcional: sin él, dos filas con el mismo created_at pueden salir en
// dos páginas distintas o en ninguna.
const ORDEN_LISTA = `ORDER BY created_at DESC, id ASC`;

// Con el filtro de "duplicados por revisar" el orden cronológico no sirve: lo útil es ver JUNTOS a
// los miembros de cada grupo, que es lo que hay que comparar. El desempate por id sigue siendo
// obligatorio por lo mismo de siempre.
const ORDEN_GRUPOS = `ORDER BY revision_dedup_grupo ASC, created_at ASC, id ASC`;

// La PAPELERA (D8) vive en `lib/contactos-papelera.ts`: qué columnas devuelve y en qué orden es
// lo único propio suyo. El filtro, la paginación y el contador son los de aquí, sin duplicar.

/** Tamaños de página admitidos. Lista blanca, no rango: un pageSize=100000 tumba la API. */
const PAGE_SIZES = [50, 100];

/**
 * Los campos de tarea admitidos al crearlas EN MASA. Es `TareaSchema` (`tareas-routes.ts`) menos
 * los cuatro que no tienen sentido para N contactos distintos — y que la ruta rechaza con un 400
 * que dice por qué, en vez de aceptarlos y no escribirlos.
 *
 * `observadores` y `checklist` sí entran: son columnas jsonb de `tareas`, no tablas aparte.
 */
const TareaMasivaSchema = z.object({
  titulo: z.string().min(2),
  descripcion: z.string().nullable().optional(),
  responsable_id: z.string().uuid().nullable().optional(),
  observadores: z.array(z.string().uuid()).optional(),
  estado: z.enum(["pendiente", "en_progreso", "completada", "cancelada"]).optional(),
  prioridad: z.enum(["baja", "normal", "alta", "urgente"]).optional(),
  fecha_inicio: z.string().nullable().optional(),
  fecha_limite: z.string().nullable().optional(),
  checklist: z.array(z.object({ texto: z.string(), hecho: z.boolean().optional() })).optional(),
});

// ---- Selección para acciones masivas ---------------------------------------------------------
// El contrato (`Seleccion` + `parsearSeleccion`) vive ahora en `lib/seleccion.ts`: no es del
// dominio de contactos y lo comparten ya el cambio masivo de etapa y la exportación de
// oportunidades. Aquí se queda solo lo que SÍ es de contactos: cómo se resuelve contra su tabla.

/**
 * Convierte una selección en la lista real de ids. En modo 'filtro' resuelve con el MISMO WHERE
 * del listado, así que el conjunto es exactamente el que el usuario vio en pantalla.
 */
async function resolverSeleccion(seleccion: Seleccion): Promise<string[]> {
  if (seleccion.modo === "ids") return seleccion.ids;
  const f = leerFiltros(seleccion.filtros || {});
  const { where, params } = construirFiltroContactos(f);
  const rows = await query<any>(
    `SELECT id FROM gozz.contactos_cache WHERE ${where} ${ORDEN_LISTA}`, params
  );
  const excluidos = new Set(seleccion.excluidos || []);
  return rows.map((r) => r.id).filter((id: string) => !excluidos.has(id));
}

// ==================== Routes ====================
export function registerContactosRoutes(app: Express) {
  // ---- SEARCH (ANTES que /:id para evitar conflicto) ----
  app.get("/api/contactos/search", requireAuth, async (req: Request, res: Response) => {
    const q = ((req.query.q as string) || "").trim();
    const tipo = ((req.query.tipo as string) || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 30);
    const params: any[] = [];
    const addP = (v: any) => { params.push(v); return `$${params.length}`; };
    const wheres: string[] = [NO_ARCHIVADOS];
    if (q.length >= 2) { const p = addP(`%${q}%`); wheres.push(`(nombre_completo ILIKE ${p} OR email ILIKE ${p} OR telefono ILIKE ${p})`); }
    if (["cliente", "lead", "referido"].includes(tipo)) wheres.push(`tipo_cliente = ${addP(tipo)}`);
    const lim = addP(limit);
    const rows = await query<any>(
      `SELECT id, nombre_completo, email, telefono, tipo_cliente, saldo_referidos_usd
         FROM gozz.contactos_cache
        ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""}
        ORDER BY ${q.length >= 2 ? "nombre_completo ASC" : "created_at DESC"} LIMIT ${lim}`,
      params
    );
    res.json({ contactos: rows });
  });

  // ---- LIST FACETS (tramites disponibles para dropdown) ----
  app.get("/api/contactos/facets", requireAuth, async (_req: Request, res: Response) => {
    const tramitesEnum = await query<any>(
      `SELECT estatus_migratorio_tipo AS tramite, count(*)::int AS n
         FROM gozz.contactos_cache
        WHERE estatus_migratorio_tipo IS NOT NULL AND ${NO_ARCHIVADOS}
        GROUP BY estatus_migratorio_tipo`
    );
    const tramites = tramitesEnum.map((r: any) => ({ tramite: r.tramite, count: r.n })).sort((a: any, b: any) => b.count - a.count);
    res.json({ tramites });
  });

  // ---- IMPACTO (ANTES que /:id para que Express no lo tome por un id) ----
  // Conteos REALES de lo que arrastra cada contacto, para la confirmación previa a archivar.
  // Una sola consulta para los N ids (ver lib/contactos-archivado.ts), no una por contacto.
  app.get("/api/contactos/impacto", requireAuth, async (req: Request, res: Response) => {
    const raw = String(req.query.ids || "").trim();
    const ids = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (ids.length === 0) { res.status(400).json({ error: "ids requerido (separados por coma)" }); return; }
    if (ids.length > 500) { res.status(400).json({ error: "máximo 500 ids por consulta" }); return; }
    if (!ids.every((id) => UUID_RE.test(id))) { res.status(400).json({ error: "ids inválidos" }); return; }
    const contactos = await contarImpacto(ids);
    const suma = (k: keyof (typeof contactos)[number]) => contactos.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    res.json({
      contactos,
      no_encontrados: ids.filter((id) => !contactos.some((c) => c.id === id)),
      totales: {
        contactos: contactos.length,
        oportunidades: suma("oportunidades"), tareas: suma("tareas"), documentos: suma("documentos"),
        carpetas_drive: suma("carpetas_drive"), notas: suma("notas"), emails: suma("emails"),
        coach_mensajes: suma("coach_mensajes"), total: suma("total"),
      },
    });
  });

  // ---- IMPACTO DE UNA SELECCIÓN (POST: acepta los dos modos) ----
  // Es lo que alimenta la confirmación informada previa a archivar (R2). El GET de arriba sigue
  // existiendo para el caso simple de "unos pocos ids"; este entiende además "seleccionar el
  // total", donde enumerar 3.800 contactos en un diálogo no tendría sentido: se devuelven SOLO
  // los totales agregados.
  app.post("/api/contactos/impacto", requireAuth, async (req: Request, res: Response) => {
    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }
    const ids = await resolverSeleccion(seleccion);
    if (ids.length === 0) { res.status(400).json({ error: "la selección no incluye ningún contacto" }); return; }

    const contactos = await contarImpacto(ids);
    const suma = (k: keyof (typeof contactos)[number]) => contactos.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    const totales = {
      contactos: contactos.length,
      oportunidades: suma("oportunidades"), tareas: suma("tareas"), documentos: suma("documentos"),
      carpetas_drive: suma("carpetas_drive"), notas: suma("notas"), emails: suma("emails"),
      coach_mensajes: suma("coach_mensajes"), total: suma("total"),
    };
    // En modo 'filtro' el detalle por contacto no se envía: con miles de filas sería un payload
    // enorme que el diálogo no usa. En modo 'ids' sí, para poder listarlos.
    res.json({ modo: seleccion.modo, totales, contactos: seleccion.modo === "ids" ? contactos : undefined });
  });

  // ---- LIST (PAGINADO EN SERVIDOR) ----
  // Antes: LIMIT sin OFFSET. No era un fallo, es que la paginación nunca se programó: cargaban
  // los 100 más recientes y no había forma de pedir el 101.
  //
  // `total` sale de un COUNT(*) que usa EXACTAMENTE el mismo WHERE que los items, porque ambos
  // lo piden al mismo constructor. Si el contador y la página no compartieran filtro, el número
  // de "Seleccionar el total (N)" mentiría y la acción masiva actuaría sobre otro conjunto.
  app.get("/api/contactos", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const filtros = leerFiltros(req.query);

    // OPT-IN EXPLÍCITO para ver los archivados (papelera de contactos). Sin este parámetro el
    // listado no cambia. Es admin-only y sirve para poder DESHACER un archivado: sin una forma
    // de encontrar lo archivado, "reversible" sería solo una palabra.
    if (filtros.archivados && !isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    // pageSize: LISTA BLANCA ESTRICTA, no un clamp. Un clamp silencioso convierte pageSize=100000
    // en 100 sin avisar; el 400 deja claro que el cliente pidió algo que no existe.
    const pageSize = req.query.pageSize === undefined ? 100 : Number(req.query.pageSize);
    if (!PAGE_SIZES.includes(pageSize)) {
      res.status(400).json({ error: `pageSize inválido: solo se admite ${PAGE_SIZES.join(" o ")}` });
      return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const offset = (page - 1) * pageSize;

    const { where, params } = construirFiltroContactos(filtros);

    // La PAPELERA (D8) no es un listado nuevo: es este mismo, con su propia proyección y su propio
    // orden. Comparte filtro, paginación y contador a propósito — duplicarlos es de donde salieron
    // los defectos que la Ola 1 arregló. Sin la 0056 se degrada sola en vez de devolver un 500.
    const [papelera, conteo] = await Promise.all([
      filtros.archivados
        ? listarPapelera(where, params, pageSize, offset)
        : query<any>(
            `SELECT ${COLS_LISTA}, ${COL_RESPONSABLE_NOMBRE} FROM gozz.contactos_cache
              WHERE ${where} ${filtros.revision_dedup ? ORDEN_GRUPOS : ORDEN_LISTA} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, pageSize, offset]
          ).then((items) => ({ items, trazabilidad: undefined as boolean | undefined })),
      query<any>(`SELECT count(*)::int AS total FROM gozz.contactos_cache WHERE ${where}`, params),
    ]);
    const total = conteo[0]?.total ?? 0;

    // Extras de la papelera: las opciones del desplegable de autor —sacadas de los datos, igual que
    // hace la del Drive— y, SOLO si hay un rango puesto, cuántos archivados se quedan fuera por no
    // tener fecha. Sin ese número, "últimos 30 días" enseña cuatro filas de 27.805 y parece que se
    // ha perdido todo.
    let autores: Awaited<ReturnType<typeof autoresDePapelera>> | undefined;
    let sinFecha: number | undefined;
    if (filtros.archivados) {
      autores = await autoresDePapelera();
      if (filtros.desde || filtros.hasta) {
        // El MISMO WHERE pero sin el rango: la pregunta es "de lo que estás mirando, cuánto se
        // queda fuera por no tener fecha", no "cuántos hay en toda la base".
        const sinRango = construirFiltroContactos({ ...filtros, desde: undefined, hasta: undefined });
        sinFecha = await contarArchivadosSinFecha(sinRango.where, sinRango.params);
      }
    }

    res.json({
      items: papelera.items, total, page, pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      trazabilidad: papelera.trazabilidad,
      autores, sin_fecha: sinFecha,
    });
  });

  // Los dos agentes de seguro que la ficha puede ofrecer, resueltos POR EMAIL en el servidor.
  // 🔴 Los uuid NO se escriben en el frontend: staging y produccion son bases distintas y esas dos
  // personas tienen id distinto en cada una — un uuid en el codigo funcionaria en un entorno y en
  // el otro guardaria "sin agente" sin decir nada. Ver `lib/contactos-agente-seguro.ts`.
  app.get("/api/contactos/agentes-seguro", requireAuth, async (_req: Request, res: Response) => {
    res.json({ agentes: await listarAgentesSeguro() });
  });

  // ---- DETAIL con negociaciones + tareas + referidos ----
  app.get("/api/contactos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const id = String(req.params.id);
    const contactos = await query<any>(
      // Aquí sí hay alias, así que el JOIN con `users` no es ambiguo. Se trae SOLO el nombre: el
      // resto de la fila de `users` no tiene nada que hacer en la ficha de un contacto.
      `SELECT ${prefijar(COLS_DETALLE, "c")}, ${colEmail("c")}, ${flagsSecretos("c")},
              r.id AS ref_id, r.nombre_completo AS ref_nombre,
              ur.nombre AS responsable_nombre,
              -- El NOMBRE del agente, resuelto aqui. La pantalla nunca ensenia un uuid (§4.7), y
              -- resolverlo alli obligaria a una segunda peticion o a cargarse la lista entera de
              -- usuarios solo para traducir un identificador.
              ua.nombre AS agente_seguro_nombre,
              -- Y si ese agente sigue activo. Un agente dado de baja NO se borra del contacto —el
              -- dato historico es real— pero la ficha tiene que poder decir que ya no esta
              -- disponible en vez de ofrecerlo como si nada.
              COALESCE(ua.activo, true) AS agente_seguro_activo
         FROM gozz.contactos_cache c
         LEFT JOIN gozz.contactos_cache r ON r.id = c.referido_por_contacto_id
         LEFT JOIN gozz.users ur ON ur.id = c.responsable_user_id
         LEFT JOIN gozz.users ua ON ua.id = c.agente_seguro_id
        WHERE c.id = $1`, [id]
    );
    const contacto = contactos[0];
    if (!contacto) { res.status(404).json({ error: "No encontrado" }); return; }

    // Junto a las banderas `tiene_*`: si esta persona puede pedir los valores por el endpoint
    // dedicado. La pantalla lo necesita para saber si el ojo va habilitado — el control **se
    // enseña igualmente** (§4.2), pero deshabilitado y diciendo por qué, en vez de dar un 403 al
    // pulsarlo. La barrera de verdad sigue estando en el endpoint.
    //
    // Hoy esto es "sigue siendo del equipo", así que para casi todo el mundo será `true`; el caso
    // que separa es el de quien ya está dado de baja pero conserva un JWT vivo. Se manda igual, y
    // se calcula con la MISMA función que decide en el endpoint: si algún día se vuelve a
    // estrechar quién pasa, la pantalla se entera sola en vez de quedarse ofreciendo un ojo que
    // devuelve 403.
    contacto.puede_ver_sensibles = await esUsuarioActivo(u?.sub);

    const oportunidades = await query<any>(
      `SELECT o.id, o.nombre_caso, o.etapa, o.valor_total, o.balance_pendiente, o.sla_estado, o.sla_fecha_limite, o.fecha_completada, o.created_at,
              tc.nombre AS tramite_nombre, tc.formulario_uscis,
              u.nombre AS preparador_nombre
         FROM gozz.oportunidades o
         LEFT JOIN gozz.tramites_config tc ON tc.id = o.tipo_tramite_id
         LEFT JOIN gozz.users u ON u.id = o.preparador_id
        WHERE o.contacto_id = $1
        ORDER BY o.created_at DESC`, [id]
    );

    const oportunidadesAbiertas = oportunidades.filter((o: any) => o.etapa !== "completada" && o.etapa !== "cancelada");
    const oportunidadesCerradas = oportunidades.filter((o: any) => o.etapa === "completada" || o.etapa === "cancelada");

    // Referidos que hizo este contacto
    const referidos = await query<any>(
      `SELECT id, nombre_completo, email, telefono, tipo_cliente, created_at
         FROM gozz.contactos_cache
        WHERE referido_por_contacto_id = $1 AND ${NO_ARCHIVADOS}
        ORDER BY created_at DESC`, [id]
    );

    // Tareas del contacto (todas, tenga o no oportunidad)
    const tareas = await query<any>(
      `SELECT t.id, t.titulo, t.estado, t.prioridad, t.fecha_limite, t.created_at,
              t.oportunidad_id, o.nombre_caso,
              u.nombre AS responsable_nombre
         FROM gozz.tareas t
         LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
         LEFT JOIN gozz.users u ON u.id = t.responsable_id
        WHERE t.contacto_id = $1 AND t.estado NOT IN ('completada','cancelada')
        ORDER BY (t.estado = 'completada'), t.fecha_limite ASC NULLS LAST, t.created_at DESC`, [id]
    );

    res.json({
      contacto,
      oportunidades,
      oportunidades_abiertas: oportunidadesAbiertas,
      oportunidades_cerradas: oportunidadesCerradas,
      referidos,
      tareas,
      referido_por: contacto.ref_id ? { id: contacto.ref_id, nombre_completo: contacto.ref_nombre } : null
    });
  });

  // ---------------------------------------------------------------------------------------
  // 🔴 LOS TRES DATOS SENSIBLES — endpoint dedicado, la ÚNICA puerta.
  //
  // El SSN y las credenciales USCIS del cliente NO viajan en la ficha ni en el listado: R11 las
  // sacó de todas las proyecciones y ahí siguen. Salen por aquí, de una en una petición explícita,
  // y **dejando constancia de quién las leyó**.
  //
  // Puede pedirlas cualquier persona activa del equipo — es el trabajo, y el razonamiento completo
  // (con lo que eso amplía y lo que lo compensa) está en la cabecera de `lib/contactos-sensibles.ts`.
  //
  // Devuelve EXCLUSIVAMENTE los tres campos: ni el nombre del contacto, ni nada más. Si esta
  // respuesta se filtra en un log o en el historial del navegador, que lleve lo mínimo.
  // ---------------------------------------------------------------------------------------
  app.get("/api/contactos/:id/datos-sensibles", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const r = await leerDatosSensibles(String(req.params.id), u?.sub);

    if (!r.ok && r.motivo === "sin_permiso") {
      // Ahora que pasa todo el equipo, el único que cae aquí es quien ya está dado de baja y
      // conserva un token válido. El mensaje dice ESO —y qué hacer— en vez de hablar de permisos
      // que no existen: si le decimos "pide aprobación", la pedirá y nadie sabrá de qué (§4.7).
      res.status(403).json({
        error: "Tu cuenta ya no está activa, así que no se pueden mostrar estos datos. Habla con un administrador.",
      });
      return;
    }
    if (!r.ok && r.motivo === "no_encontrado") { res.status(404).json({ error: "No encontrado" }); return; }
    if (!r.ok) {
      // `sin_bitacora`: se pudo leer pero no anotar. No se entrega — ver `leerDatosSensibles`.
      res.status(500).json({ error: "No se pudo registrar la consulta en la bitácora, así que no se entregan los datos." });
      return;
    }

    res.json(r.datos);
  });

  // ---- CREATE ----
  app.post("/api/contactos", requireAuth, async (req: Request, res: Response) => {
    const parsed = ContactoFullSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as any;

    // ════════════════════════════════════════════════════════════════════════════════════════
    // LO QUE SE EXIGE AL CREAR — Y SOLO AL CREAR
    // ════════════════════════════════════════════════════════════════════════════════════════
    // Email y telefono, obligatorios desde la tanda C3. WhatsApp sigue opcional. La pantalla ya no
    // deja guardar sin ellos, pero la UI NUNCA es la unica barrera (§4.2): esta ruta la llama
    // tambien quien no pasa por el modal.
    //
    // 🔴 LA FECHA DE NACIMIENTO **NO** SE EXIGE (2026-08-31). Si viene, tiene que valer; si no
    // viene, se da de alta igual. El porque —y el 97,2 % de la cartera que no la tiene— esta en
    // la cabecera de `lib/contactos-alta.ts`.
    //
    // ⚠️ SE COMPRUEBA AQUI Y NO EN `ContactoFullSchema` PORQUE ESE ESQUEMA LO COMPARTEN EL ALTA Y
    // LA EDICION. Endurecerlo alli **romperia el PATCH de los 670 contactos vivos sin email**:
    // cualquiera que abriera una de esas fichas a cambiar un telefono se encontraria con que ya
    // no puede guardar. Lo nuevo se exige a lo nuevo; lo que ya estaba se sigue editando igual.
    //
    // Los mensajes no nombran la columna (§4.7): dicen que pasa, no como se llama por dentro.
    const falta = queFaltaParaElAlta(d);
    if (falta) { res.status(400).json({ error: falta }); return; }

    // 🔴 `""` NO ES `NULL` PARA POSTGRES, y `fecha_nacimiento` es una columna `date`. El esquema
    // acepta la cadena vacia, asi que sin esto un formulario dejado en blanco entraria como
    // `fecha_nacimiento = ''` y Postgres devolveria `22007` — un 500 donde tenia que haber un
    // alta correcta. Solo se toca la clave si venia: anadirla cuando no venia la metería en el
    // INSERT sin motivo.
    if (Object.prototype.hasOwnProperty.call(d, "fecha_nacimiento")) {
      d.fecha_nacimiento = normalizarFechaNacimiento(d.fecha_nacimiento);
    }
    const nombreCompleto = buildNombreCompleto(d) || "Sin nombre";

    const fields = ["nombre_completo", ...Object.keys(d).filter((k) => k !== "nombre_completo" && d[k] !== undefined)];
    const values: any[] = fields.map((k) => {
      if (k === "nombre_completo") return nombreCompleto;
      if (k === "etiquetas") return JSON.stringify(d.etiquetas || []);
      return d[k];
    });
    const placeholders = fields.map((k, i) => k === "etiquetas" ? `$${i + 1}::jsonb` : `$${i + 1}`).join(", ");
    const rows = await query<any>(
      `INSERT INTO gozz.contactos_cache (${fields.join(", ")}) VALUES (${placeholders})
       RETURNING ${COLS_DETALLE}, ${colEmail()}, ${flagsSecretos()}`,
      values
    );
    const created: ContactoDetalle = rows[0];
    res.json({ contacto: created });
  });

  // ---- PATCH ----
  app.patch("/api/contactos/:id", requireAuth, async (req: Request, res: Response) => {
    const parsed = ContactoFullSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data as any;

    // La misma normalizacion que el alta, y por el mismo motivo: `""` contra una columna `date`
    // es un `22007` de Postgres, o sea un 500. Aqui el caso es **vaciar** la fecha de una ficha
    // que la tenia: `DateField` escribe `""` al borrarse y la ficha manda el formulario entero.
    //
    // 🔴 Solo se normaliza si la clave VENIA. Ponerla a `null` cuando no venia la metería en el
    // `UPDATE` y **borraria la fecha en cada guardado** que no la incluyera.
    //
    // ⚠️ Aqui NO se valida, a diferencia del alta, y es deliberado: la ficha devuelve lo que leyo,
    // y una columna `date` se serializa como `1980-03-12T00:00:00.000Z`. `esFechaDeNacimientoValida`
    // rechaza esa forma —exige `YYYY-MM-DD` pelado—, asi que validar aqui haria que **guardar
    // cualquier ficha que ya tenga fecha devolviera 400**. Lo que llega por pantalla lo produce
    // `DateField`, que solo emite `YYYY-MM-DD` o vacio.
    if (Object.prototype.hasOwnProperty.call(d, "fecha_nacimiento")) {
      d.fecha_nacimiento = normalizarFechaNacimiento(d.fecha_nacimiento);
    }

    // ════════════════════════════════════════════════════════════════════════════════════════
    // EL AGENTE DE SEGURO — se resuelve ANTES de construir el UPDATE
    // ════════════════════════════════════════════════════════════════════════════════════════
    // Las reglas viven en `lib/contactos-agente-seguro.ts` (y su porque, que es largo). Aqui solo
    // se aplican, en este orden y no en otro:
    //
    //   1) si el contacto deja de tener seguro, las DOS columnas se limpian a la vez — un
    //      contacto sin seguro con agente asignado es el estado que ensucia la segmentacion;
    //   2) si se asigna un agente, tiene que existir y estar activo, o 400 y no se guarda nada.
    //      🔴 NO se coacciona a nulo (§2.8.3): un id malo guardado como NULL sale del CRM como
    //      "sin agente" y quien lo puso cree que segmento.
    if (Object.prototype.hasOwnProperty.call(d, "tiene_seguro_salud") && pierdeElSeguro(d.tiene_seguro_salud)) {
      d.agente_seguro_id = null;
      d.agente_seguro_otro = null;
    } else if (d.agente_seguro_id !== undefined || d.agente_seguro_otro !== undefined) {
      const r = await resolverAgenteSeguro(d);
      if (!r.ok) { res.status(400).json({ error: r.error }); return; }
      // Las dos se escriben SIEMPRE juntas: son excluyentes, y dejar una sin tocar es como se
      // llega al estado que el CHECK de la base rechaza.
      d.agente_seguro_id = r.agente_seguro_id;
      d.agente_seguro_otro = r.agente_seguro_otro;
    }

    const fields = Object.keys(d).filter((k) => d[k] !== undefined);
    if (fields.length === 0) { res.json({ ok: true }); return; }

    // Si se cambia nombre/apellido pero no nombre_completo, recalcular
    if (!d.nombre_completo && (d.nombre || d.apellido || d.segundo_nombre)) {
      const current = (await query<any>("SELECT nombre, apellido, segundo_nombre FROM gozz.contactos_cache WHERE id = $1", [req.params.id]))[0];
      if (current) {
        const merged = { nombre: d.nombre ?? current.nombre, apellido: d.apellido ?? current.apellido, segundo_nombre: d.segundo_nombre ?? current.segundo_nombre };
        const nc = buildNombreCompleto(merged);
        if (nc) { d.nombre_completo = nc; if (!fields.includes("nombre_completo")) fields.push("nombre_completo"); }
      }
    }

    const setParts = fields.map((k, i) => {
      if (k === "etiquetas") return `etiquetas = $${i + 2}::jsonb`;
      return `${k} = $${i + 2}`;
    });
    const values = fields.map((k) => {
      if (k === "etiquetas") return JSON.stringify(d.etiquetas || []);
      return d[k];
    });
    const rows = await query<ContactoDetalle>(
      `UPDATE gozz.contactos_cache SET ${setParts.join(", ")} WHERE id = $1
       RETURNING ${COLS_DETALLE}, ${colEmail()}, ${flagsSecretos()}`,
      [req.params.id, ...values]
    );
    res.json({ contacto: rows[0] });
  });

  // ---- DELETE = ARCHIVADO LÓGICO ----
  // "Eliminar un contacto" NO borra la fila: la marca `archivado = true`. Para el usuario el
  // contacto desaparece igual (deja de salir en listados, búsqueda, contadores y selectores),
  // pero todo lo que cuelga de él —oportunidades, tareas, documentos, notas, emails— sigue
  // intacto y la operación se puede deshacer desde /desarchivar.
  //
  // ⚠️ Antes de la OLA 0 esto era un DELETE físico. Ese DELETE fallaba con 23503 en cuanto el
  // contacto tenía una oportunidad, tarea o carpeta (4 FKs en ON DELETE NO ACTION), lo que hacía
  // de red de seguridad involuntaria. Con el archivado esa red YA NO EXISTE: quien llame aquí
  // debe haber mostrado antes los conteos de GET /api/contactos/impacto. Ver lib/contactos-archivado.ts.
  //
  // El borrado físico de archivos NO ocurre en este camino (se retiró la llamada a
  // deleteUploadsIfUnreferenced): archivar jamás toca un byte en disco ni en R2.
  app.delete("/api/contactos/:id", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const id = String(req.params.id);
    const existe = (await query<any>("SELECT id FROM gozz.contactos_cache WHERE id = $1", [id]))[0];
    if (!existe) { res.status(404).json({ error: "No encontrado" }); return; }

    const motivo = String(req.body?.motivo || "").trim() || "eliminado por usuario";
    const r = await archivarContactos([id], { userId: u?.sub || null, motivo });
    // Idempotente: repetir la llamada no vuelve a escribir ni duplica la fila de auditoría.
    if (r.afectados.length === 0) { res.json({ ok: true, archivado: true, ya_archivado: true }); return; }
    res.json({ ok: true, archivado: true, ya_archivado: false, impacto: r.afectados[0] });
  });

  // ---- ARCHIVADO MASIVO ----
  // Mismo archivado lógico que el DELETE individual, sobre un conjunto. Acepta las DOS formas de
  // selección desde ya porque ese contrato lo consumirán también fusionar y exportar (Olas 2-3).
  //
  // La barrera de autorización está AQUÍ, no en la UI: el botón se le muestra a todo el mundo
  // (así se pidió), pero un usuario normal recibe 403 y el aviso de que necesita aprobación. El
  // flujo real de solicitudes llega en la Ola 3.
  app.post("/api/contactos/archivar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }

    if (!isAdmin(u)) {
      res.status(403).json({
        error: "requiere_aprobacion",
        mensaje: "Archivar contactos requiere aprobación del administrador (próximamente).",
      });
      return;
    }

    const ids = await resolverSeleccion(seleccion);
    if (ids.length === 0) { res.status(400).json({ error: "la selección no incluye ningún contacto" }); return; }

    const motivo = String(req.body?.motivo || "").trim() || "eliminado por usuario";
    const r = await archivarContactos(ids, { userId: u?.sub || null, motivo });
    res.json({
      ok: true,
      solicitados: ids.length,
      archivados: r.afectados.length,
      ya_estaban_archivados: r.sin_cambios.length,
    });
  });

  // ============================================================================================
  // ACCIONES MASIVAS · OLA 3 · ETAPA 2 — cambiar responsable y agregar tarea
  //
  // Las dos comparten el contrato de selección con Archivar y Fusionar (`parsearSeleccion` /
  // `resolverSeleccion`), así que en modo 'filtro' actúan sobre EXACTAMENTE el conjunto que el
  // usuario vio en pantalla, no sobre uno recalculado con otro criterio.
  //
  // 🔴 EL PERMISO SE CONSULTA A LA BASE, no al JWT (§2.4). Los tokens duran 365 días y no se
  // refrescan: a quien le retiren el rol de admin lo conserva en su token hasta un año. Para una
  // acción que escribe sobre miles de contactos, esa diferencia importa.
  // ⚠️ Los endpoints de archivar y fusionar todavía usan el `isAdmin(u)` del JWT: es deuda conocida
  // y declarada, no un criterio distinto.
  // ============================================================================================

  /** El 403 común: mismo mensaje que Eliminar. El flujo de solicitud real llega en la Etapa 3. */
  const rechazoNoAdmin = (res: Response, accion: string) =>
    res.status(403).json({
      error: "requiere_aprobacion",
      mensaje: `${accion} requiere aprobación del administrador (próximamente).`,
    });

  // ---- CAMBIAR RESPONSABLE (admin) ----
  app.post("/api/contactos/responsable", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }

    if (!(await esAdminEnBase(u?.sub))) { rechazoNoAdmin(res, "Cambiar el responsable"); return; }

    // Ausente ≠ null, y validación contra usuarios activos ANTES de escribir nada. Las dos reglas
    // viven en `lib/contactos-acciones.ts` —con su porqué— para que sean comprobables.
    const lectura = leerResponsableId(req.body);
    if (lectura.error) { res.status(400).json({ error: lectura.error }); return; }
    const responsableId = lectura.responsableId as string | null;

    const valido = await validarResponsableAsignable(responsableId);
    if (!valido.ok) { res.status(400).json({ error: valido.error }); return; }

    const ids = await resolverSeleccion(seleccion);
    if (ids.length === 0) { res.status(400).json({ error: "la selección no incluye ningún contacto" }); return; }

    const r = await asignarResponsable(ids, responsableId, { userId: u?.sub || null });

    // UNA notificación que resume, no N (§3.4 + el porqué en `contactos-acciones.ts`). Y solo si
    // hubo cambios de verdad y el destinatario no es quien la ejecutó.
    if (r.notificar && r.notificar.userId !== u?.sub) {
      const n = r.notificar.contactos;
      // 🔴 El enlace lleva al listado YA FILTRADO por esa persona. Antes iba a `/contactos` a secas,
      // donde no había forma de distinguir cuáles eran los suyos —el responsable ni siquiera se
      // devolvía—: el aviso prometía algo que la interfaz no podía cumplir.
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
         VALUES ($1, 'contactos_asignados', $2, $3, 'normal', $4)`,
        [r.notificar.userId, "Contactos asignados",
         `Te han asignado ${n} contacto${n === 1 ? "" : "s"}.`,
         `/contactos?responsable=${r.notificar.userId}`]
      );
      // Sin el emit, la campanita no se entera hasta que alguien recargue la página (§3.4).
      emitToUser(r.notificar.userId, "notificacion:nueva", { tipo: "contactos_asignados", contactos: n });
    }

    res.json({ ok: true, solicitados: ids.length, cambiados: r.cambiados, sin_cambios: r.sin_cambios });
  });

  // ---- AGREGAR TAREA A CADA CONTACTO (admin) ----
  //
  // Son N tareas, una por contacto: `tareas.contacto_id` es escalar con FK y no hay tabla puente.
  // No es una elección de diseño de esta ruta, es lo único que el esquema admite.
  app.post("/api/contactos/tareas", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const { seleccion, error } = parsearSeleccion(req.body);
    if (error || !seleccion) { res.status(400).json({ error }); return; }

    if (!(await esAdminEnBase(u?.sub))) { rechazoNoAdmin(res, "Agregar una tarea en masa"); return; }

    const cuerpoTarea = (req.body as any)?.tarea ?? {};

    // ⚠️ Campos que NO se aceptan en masa. Se rechazan con su motivo en vez de aceptarlos y no
    // escribirlos: un campo que el usuario rellenó y se pierde en silencio es peor que un error.
    const noAdmitidos: Record<string, string> = {
      contacto_id: "lo pone la selección: cada tarea va a su contacto",
      oportunidad_id: "ataría las N tareas de N contactos distintos a una sola oportunidad",
      subtarea_de: "ataría las N tareas al mismo padre, que pertenece a otro contacto",
      plantilla_id: "la expansión de plantilla solo existe en la creación individual; duplicarla aquí divergiría",
    };
    for (const [campo, motivo] of Object.entries(noAdmitidos)) {
      if (cuerpoTarea[campo] !== undefined && cuerpoTarea[campo] !== null) {
        res.status(400).json({ error: `"${campo}" no se admite al crear tareas en masa: ${motivo}.` });
        return;
      }
    }

    // El mismo esquema que la creación individual, sin los campos de arriba. `observadores` y
    // `checklist` SÍ se aceptan: son columnas jsonb de `tareas`, no tablas aparte, así que se
    // escriben para las N sin coste extra.
    const parsed = TareaMasivaSchema.safeParse(cuerpoTarea);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

    if (parsed.data.responsable_id) {
      const valido = await validarResponsableAsignable(parsed.data.responsable_id);
      if (!valido.ok) { res.status(400).json({ error: valido.error }); return; }
    }

    const ids = await resolverSeleccion(seleccion);
    if (ids.length === 0) { res.status(400).json({ error: "la selección no incluye ningún contacto" }); return; }
    // Tope DECLARADO, no recorte silencioso: ver `MAX_TAREAS_POR_OPERACION`.
    if (ids.length > MAX_TAREAS_POR_OPERACION) {
      res.status(400).json({
        error: `la selección son ${ids.length} contactos y el máximo por operación es ${MAX_TAREAS_POR_OPERACION}. Afina el filtro y hazlo por tandas.`,
        seleccionados: ids.length,
        maximo: MAX_TAREAS_POR_OPERACION,
      });
      return;
    }

    const r = await crearTareasParaContactos(ids, parsed.data, { userId: u.sub });

    if (r.notificar) {
      const n = r.notificar.tareas;
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url)
         VALUES ($1, 'tarea_asignada', $2, $3, $4, '/tareas')`,
        [r.notificar.userId, "Tareas asignadas",
         `Te han asignado ${n} tarea${n === 1 ? "" : "s"}: "${parsed.data.titulo}".`,
         parsed.data.prioridad === "urgente" ? "critica" : parsed.data.prioridad === "alta" ? "alta" : "normal"]
      );
      emitToUser(r.notificar.userId, "notificacion:nueva", { tipo: "tarea_asignada", tareas: n });
    }

    res.json({ ok: true, creadas: r.creadas, contactos: ids.length, auditoria_id: r.auditoriaId });
  });

  // ============================================================================================
  // FUSIÓN DE CONTACTOS
  // ============================================================================================

  // ---- PREVIEW: lo que necesita el modal comparativo ----
  // Devuelve las dos fichas (proyección explícita, R11: sin SSN ni claves), qué columnas son
  // elegibles y cuáles no con su motivo, los contadores de lo que aporta cada uno, y el maestro
  // sugerido por la heurística CON su explicación.
  app.get("/api/contactos/fusion/preview", requireAuth, async (req: Request, res: Response) => {
    // m2: admin, igual que fusionar y revertir — el preview enseña dos fichas completas.
    if (!isAdmin((req as any).user)) { res.status(403).json({ error: "Solo admin" }); return; }
    const a = String(req.query.a || ""), b = String(req.query.b || "");
    if (!UUID_RE.test(a) || !UUID_RE.test(b)) { res.status(400).json({ error: "se requieren dos ids válidos (a, b)" }); return; }
    if (a === b) { res.status(400).json({ error: "son el mismo contacto" }); return; }

    const { elegibles: elegiblesMotor, noElegibles } = await columnasEnriquecibles();
    // I2: el MOTOR sigue fusionando los tres campos sensibles (para no perder un SSN que solo tenía
    // el perdedor), pero la INTERFAZ no los ofrece: sus valores no viajan por R11, así que el modal
    // los pintaría vacíos y una elección a ciegas sobreescribiría un dato real e invisible.
    // Aquí se separan las dos listas, que hasta ahora eran la misma por accidente.
    const elegibles = elegiblesMotor.filter((c) => !CAMPOS_NO_ELEGIBLES_POR_SENSIBLES.includes(c));
    for (const c of CAMPOS_NO_ELEGIBLES_POR_SENSIBLES) noElegibles[c] = MOTIVO_SENSIBLE;

    const visibles = [...elegibles, "id", "nombre_completo", "created_at", "updated_at", "archivado"]
      .filter((c) => !COLUMNAS_SECRETAS.includes(c));
    const cols = [...new Set(visibles)].join(", ");

    const filas = await query<any>(
      `SELECT ${cols} FROM gozz.contactos_cache WHERE id = ANY($1::uuid[])`, [[a, b]]
    );
    if (filas.length !== 2) { res.status(404).json({ error: "alguno de los contactos no existe" }); return; }
    const archivado = filas.find((f) => f.archivado === true);
    if (archivado) { res.status(400).json({ error: "no se puede fusionar un contacto archivado" }); return; }

    const impacto = await contarImpacto([a, b]);
    const numOps = new Map(impacto.map((i) => [i.id, i.oportunidades]));
    const sugerido = sugerirMaestro(filas as any, numOps);

    // Advertencia de FAMILIA (D5). Antes era igualdad exacta del nombre normalizado, y por eso
    // saltaba en casi todo lo que llega a esta pantalla: dos duplicados reales casi nunca tienen el
    // nombre escrito idéntico —si lo tuvieran, la dedup automática ya los habría fusionado sin
    // pedir revisión—. Ahora es una señal graduada; el porqué y los umbrales, en `contactos-dedup.ts`.
    // `posible_familia` se conserva para el frontend que ya lo consume, pero DERIVADO del nivel.
    const parecido = await analizarParecidoNombres(filas[0].nombre_completo, filas[1].nombre_completo);

    res.json({
      contactos: filas,
      impacto,
      elegibles,
      no_elegibles: noElegibles,
      maestro_sugerido: sugerido.maestroId,
      maestro_motivo: sugerido.motivo,
      posible_familia: parecido.posible_familia,
      parecido_nivel: parecido.nivel,
      parecido_similitud: parecido.similitud,
      parecido_motivo: parecido.motivo,
    });
  });

  // ---- FUSIONAR (admin) ----
  // EXACTAMENTE 2 contactos: un maestro y un perdedor. Ni 3 ni 10. Fusionar a ciegas sobre un
  // conjunto grande es irreversible en la práctica, y el modal comparativo solo tiene sentido
  // con dos columnas.
  app.post("/api/contactos/fusionar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }

    // Modo 'filtro' explícitamente rechazado: no se fusiona "todo lo que cumpla un filtro".
    if (req.body?.seleccion?.modo === "filtro") {
      res.status(400).json({ error: "la fusión no admite el modo 'filtro': selecciona exactamente 2 contactos" });
      return;
    }
    const maestroId = String(req.body?.maestroId || "");
    const perdedorId = String(req.body?.perdedorId || "");
    // Se rechaza explícitamente el array plural por si algún cliente viejo lo manda.
    if (Array.isArray(req.body?.perdedorIds)) {
      res.status(400).json({ error: "la fusión es de exactamente 2 contactos: usa perdedorId (singular)" });
      return;
    }
    if (!UUID_RE.test(maestroId) || !UUID_RE.test(perdedorId)) { res.status(400).json({ error: "maestroId y perdedorId deben ser uuid" }); return; }
    if (maestroId === perdedorId) { res.status(400).json({ error: "el maestro y el perdedor no pueden ser el mismo contacto" }); return; }

    const valoresElegidos = req.body?.valoresElegidos ?? {};
    if (typeof valoresElegidos !== "object" || Array.isArray(valoresElegidos)) {
      res.status(400).json({ error: "valoresElegidos debe ser un objeto { campo: contactoIdDeOrigen }" }); return;
    }
    // Validación en el SERVIDOR, no en el cliente: el campo tiene que ser elegible y el origen
    // tiene que ser uno de los DOS contactos de esta fusión. Nada de valores crudos del cliente —
    // el servidor lee el valor de la fila de origen, o esto sería un endpoint de edición
    // arbitraria sin las validaciones del formulario, y el valor_despues del log dejaría de ser fiable.
    const { elegibles } = await columnasEnriquecibles();
    // I2: los sensibles se excluyen también AQUÍ, no solo en el preview. Si no se pueden ver, no se
    // pueden elegir — un cliente que los mandara estaría eligiendo a ciegas sobre un dato real.
    const setElegibles = new Set(elegibles.filter((c) => !CAMPOS_NO_ELEGIBLES_POR_SENSIBLES.includes(c)));
    for (const [campo, origen] of Object.entries(valoresElegidos as Record<string, string>)) {
      if (CAMPOS_NO_ELEGIBLES_POR_SENSIBLES.includes(campo)) {
        res.status(400).json({ error: `campo sensible no elegible: ${campo}. ${MOTIVO_SENSIBLE}` });
        return;
      }
      if (!setElegibles.has(campo)) { res.status(400).json({ error: `campo no elegible: ${campo}` }); return; }
      if (origen !== maestroId && origen !== perdedorId) { res.status(400).json({ error: `origen ajeno a esta fusión en el campo ${campo}` }); return; }
    }

    try {
      // D9: el motivo dice de DÓNDE vino la fusión. `fusionar()` ya aceptaba `opts.motivo`; la ruta
      // simplemente no se lo pasaba, así que una fusión hecha en pantalla era indistinguible de una
      // corrida masiva del CLI. Ver `MOTIVO_FUSION_INTERFAZ` y el porqué del prefijo.
      const r = await fusionar(maestroId, perdedorId, {
        valoresElegidos, userId: u?.sub || null, motivo: MOTIVO_FUSION_INTERFAZ,
      });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "no se pudo fusionar" });
    }
  });

  // ---- REVERTIR una fusión (admin) ----
  app.post("/api/contactos/fusiones/:corridaId/revertir", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const corridaId = String(req.params.corridaId);
    if (!UUID_RE.test(corridaId)) { res.status(400).json({ error: "corrida_id inválido" }); return; }

    // 🔴 ACOTADO A FUSIONES DE LA UI, A PROPÓSITO.
    // `contactos_merge_log` no guarda solo las fusiones de esta pantalla: guarda también las
    // corridas MASIVAS de scripts/dedup-contactos.mjs (~21.400 filas en staging; una sola corrida
    // llegó a fusionar 356 grupos). `revertir()` reproduce a la inversa TODO lo que haya bajo ese
    // corrida_id, así que sin este guard un admin con un uuid podría deshacer por HTTP una corrida
    // entera de saneamiento, en una transacción, sin confirmación y sin saber su alcance.
    // Una fusión de la UI tiene EXACTAMENTE un perdedor (D1). Más de uno ⇒ es del CLI.
    const alcance = (await query<any>(
      `SELECT count(*)::int AS filas, count(DISTINCT perdedor_id)::int AS perdedores
         FROM gozz.contactos_merge_log WHERE corrida_id = $1`, [corridaId]
    ))[0];
    if (!alcance || alcance.filas === 0) { res.status(404).json({ error: "no hay nada registrado para esa corrida" }); return; }
    // `!== 1` y no `> 1`: una fusión de la UI tiene EXACTAMENTE un perdedor. El caso 0 también es
    // del CLI — `marcarRevision()` (scripts/dedup-contactos.mjs) loguea SIN `perdedor_id`, así que
    // una corrida que solo marcó candidatos a revisión y no fusionó nada da `perdedores = 0` y se
    // colaría por un `> 1`.
    if (alcance.perdedores !== 1) {
      res.status(400).json({
        error: "corrida_masiva_no_reversible_por_api",
        mensaje: `Esa corrida afecta a ${alcance.perdedores} contactos fusionados (${alcance.filas} operaciones): es una corrida del CLI, no una fusión hecha desde esta pantalla. Una fusión de la UI tiene exactamente un contacto archivado. Revertirla por API desharía todo el lote de una vez. Se revierte con: node scripts/dedup-contactos.mjs --revert=${corridaId}`,
        alcance,
      });
      return;
    }

    try {
      const r = await revertir(corridaId);
      if (r.filas === 0) { res.status(404).json({ error: "no hay nada registrado para esa corrida" }); return; }
      await query(
        `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
         VALUES ($1, $2, 'contactos_cache', $3, $4::jsonb, $5::jsonb)`,
        [u?.sub || null, `Revirtió la fusión ${corridaId}`, corridaId,
         JSON.stringify({ corrida_id: corridaId, alcance }), JSON.stringify({ filas_restauradas: r.filas, por_accion: r.porAccion })]
      ).catch(() => {});
      res.json({ ok: true, ...r, alcance });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "no se pudo revertir" });
    }
  });

  // ---- DESARCHIVAR (deshacer el "eliminar") ----
  // El archivado es reversible de verdad: este es el camino de vuelta, y también queda auditado.
  app.post("/api/contactos/:id/desarchivar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const id = String(req.params.id);
    // La regla vive en el módulo de archivado (`comprobarDesarchivado`), no aquí: la papelera
    // necesita conocerla también, y con la decisión en un solo sitio la pantalla no puede ofrecer
    // un botón que el servidor rechaza.
    const chk = await comprobarDesarchivado(id);
    if (!chk.existe) { res.status(404).json({ error: "No encontrado" }); return; }
    if (chk.bloqueado) {
      res.status(409).json({ error: chk.error, fusionado_en_contacto_id: chk.fusionado_en_contacto_id });
      return;
    }
    const motivo = String(req.body?.motivo || "").trim() || "desarchivado por usuario";
    const r = await desarchivarContactos([id], { userId: u?.sub || null, motivo });
    res.json({ ok: true, archivado: false, ya_activo: r.afectados.length === 0 });
  });

  // ---- TAREAS del contacto ----
  app.get("/api/contactos/:id/tareas", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      `SELECT t.*, u.nombre AS responsable_nombre, o.nombre_caso AS oportunidad_nombre
         FROM gozz.tareas t
         LEFT JOIN gozz.users u ON u.id = t.responsable_id
         LEFT JOIN gozz.oportunidades o ON o.id = t.oportunidad_id
        WHERE t.contacto_id = $1 AND t.estado NOT IN ('completada','cancelada')
        ORDER BY (t.estado = 'completada'), t.fecha_limite ASC NULLS LAST, t.created_at DESC`,
      [req.params.id]
    );
    res.json({ tareas: rows });
  });

  // ==================== DESCUENTOS ====================
  // Solicitar descuento
  app.post("/api/oportunidades/:id/descuento", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const parsed = DescuentoSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }
    const d = parsed.data;

    // Si hay referido_contacto_id, validar que tiene saldo suficiente
    if (d.referido_contacto_id) {
      const ref = (await query<any>("SELECT saldo_referidos_usd FROM gozz.contactos_cache WHERE id = $1", [d.referido_contacto_id]))[0];
      if (!ref) { res.status(400).json({ error: "Referido no encontrado" }); return; }
      if (d.monto && Number(ref.saldo_referidos_usd || 0) < Number(d.monto)) {
        res.status(400).json({ error: `Saldo insuficiente. Disponible: $${Number(ref.saldo_referidos_usd).toFixed(2)}` });
        return;
      }
    }

    const rows = await query<any>(
      `INSERT INTO gozz.oportunidad_descuento_solicitudes
         (oportunidad_id, monto, porcentaje, motivo, referido_contacto_id, solicitante_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente') RETURNING *`,
      [req.params.id, d.monto ?? null, d.porcentaje ?? null, d.motivo, d.referido_contacto_id ?? null, u.sub]
    );

    // Notificación barra fija a todos los admins
    const admins = await query<any>("SELECT id FROM gozz.users WHERE nivel_acceso IN ('admin','super_admin') AND activo = true");
    const solicitante = (await query<any>("SELECT nombre, foto_perfil_url FROM gozz.users WHERE id = $1", [u.sub]))[0];
    const op = (await query<any>("SELECT nombre_caso FROM gozz.oportunidades WHERE id = $1", [req.params.id]))[0];
    const montoDesc = d.monto ? `$${d.monto}` : `${d.porcentaje}%`;
    for (const a of admins) {
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
         VALUES ($1, 'descuento_solicitud', $2, $3, 'critica', $4, $5::jsonb)`,
        [
          a.id,
          `Descuento solicitado por ${solicitante?.nombre || "Alguien"}`,
          `${montoDesc} en ${op?.nombre_caso || "oportunidad"}: ${d.motivo}`,
          `/oportunidades/${req.params.id}`,
          JSON.stringify({ descuento_id: rows[0].id, oportunidad_id: req.params.id, solicitante: u.sub, from_nombre: solicitante?.nombre, from_foto: solicitante?.foto_perfil_url })
        ]
      );
      emitToUser(a.id, "descuento:solicitud", {
        descuento_id: rows[0].id,
        oportunidad_id: req.params.id,
        oportunidad_titulo: op?.nombre_caso,
        from_user_id: u.sub,
        from_nombre: solicitante?.nombre || "Solicitante",
        from_foto: solicitante?.foto_perfil_url,
        monto: d.monto,
        porcentaje: d.porcentaje,
        motivo: d.motivo,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ descuento: rows[0] });
  });

  // Listar descuentos de una oportunidad
  app.get("/api/oportunidades/:id/descuentos", requireAuth, async (req: Request, res: Response) => {
    const rows = await query<any>(
      // Nombres canónicos desde la 0065. Los alias siguen la nomenclatura de la bandeja
      // (`solicitante_nombre` / `aprobador_nombre`), que es la que ya usan monto y pago.
      `SELECT d.*, s.nombre AS solicitante_nombre, r.nombre AS aprobador_nombre,
              rc.nombre_completo AS referido_nombre
         FROM gozz.oportunidad_descuento_solicitudes d
         LEFT JOIN gozz.users s ON s.id = d.solicitante_id
         LEFT JOIN gozz.users r ON r.id = d.aprobador_id
         LEFT JOIN gozz.contactos_cache rc ON rc.id = d.referido_contacto_id
        WHERE d.oportunidad_id = $1
        ORDER BY d.created_at DESC`,
      [req.params.id]
    );
    res.json({ descuentos: rows });
  });

  // Aprobar/rechazar descuento (solo admin)
  app.post("/api/descuentos/:id/revisar", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    if (!isAdmin(u)) { res.status(403).json({ error: "Solo admin" }); return; }
    const { accion, comentario } = req.body || {};
    if (!["aprobar", "rechazar"].includes(accion)) { res.status(400).json({ error: "accion inválida" }); return; }

    // Rechazar exige motivo desde la 0065: es el CHECK `rechazada ⇒ motivo_rechazo NOT NULL` de la
    // forma canónica. Se valida aquí para devolver un 400 con mensaje en vez de un 500 del CHECK.
    const motivoRechazo = String(comentario || "").trim() || null;
    if (accion === "rechazar" && !motivoRechazo) {
      res.status(400).json({ error: "El motivo del rechazo es obligatorio" });
      return;
    }

    const d = (await query<any>("SELECT * FROM gozz.oportunidad_descuento_solicitudes WHERE id = $1", [req.params.id]))[0];
    if (!d) { res.status(404).json({ error: "Descuento no encontrado" }); return; }
    if (d.estado !== "pendiente") { res.status(400).json({ error: "Ya revisado" }); return; }

    const nuevoEstado = accion === "aprobar" ? "aprobada" : "rechazada";

    // El descuento aprobado es una REBAJA del valor a cobrar, NO un pago. Al aprobar snapshotamos
    // monto_efectivo (monto fijo o el % aplicado sobre el valor_total actual) y recalculamos el
    // balance con el helper central (valor_total - descuentos - pagos). Ver lib/oportunidad-balance.
    let montoEfectivo = 0;
    if (accion === "aprobar") {
      const op = (await query<any>("SELECT valor_total FROM gozz.oportunidades WHERE id = $1", [d.oportunidad_id]))[0];
      montoEfectivo = Number(d.monto || 0);
      if (!montoEfectivo && d.porcentaje) {
        montoEfectivo = Math.round(Number(op?.valor_total || 0) * (Number(d.porcentaje) / 100) * 100) / 100;
      }
    }

    await query(
      `UPDATE gozz.oportunidad_descuento_solicitudes
         SET estado = $1, aprobador_id = $2, resolved_at = NOW(), motivo_rechazo = $3,
             monto_efectivo = CASE WHEN $1 = 'aprobada' THEN $5 ELSE monto_efectivo END
       WHERE id = $4`,
      [nuevoEstado, u.sub, motivoRechazo, req.params.id, montoEfectivo]
    );

    if (accion === "aprobar") {
      await recomputeBalance(d.oportunidad_id);

      // Si hay referido: el crédito del referido cubre la rebaja, así que se descuenta de su saldo.
      if (d.referido_contacto_id && montoEfectivo > 0) {
        await query(
          "UPDATE gozz.contactos_cache SET saldo_referidos_usd = GREATEST(0, COALESCE(saldo_referidos_usd,0) - $1) WHERE id = $2",
          [montoEfectivo, d.referido_contacto_id]
        );
      }
    }

    // Notificar al solicitante
    if (d.solicitante_id && d.solicitante_id !== u.sub) {
      await query(
        `INSERT INTO gozz.notificaciones (user_id, tipo, titulo, mensaje, prioridad, accion_url, metadata)
         VALUES ($1, 'descuento_resuelto', $2, $3, 'alta', $4, $5::jsonb)`,
        [
          d.solicitante_id,
          `Descuento ${nuevoEstado}`,
          `Tu solicitud de descuento fue ${nuevoEstado}${motivoRechazo ? ": " + motivoRechazo : ""}`,
          `/oportunidades/${d.oportunidad_id}`,
          JSON.stringify({ descuento_id: d.id, estado: nuevoEstado })
        ]
      );
      emitToUser(d.solicitante_id, "notificacion:nueva", { tipo: "descuento_resuelto", descuento_id: d.id, estado: nuevoEstado });
    }

    const updated = (await query<any>("SELECT * FROM gozz.oportunidad_descuento_solicitudes WHERE id = $1", [req.params.id]))[0];
    res.json({ descuento: updated });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // LOS DOCUMENTOS DE UN CONTACTO, ORGANIZADOS POR NEGOCIACIÓN — T3 (reunión del 2026-08-24)
  //
  // «Cuando entras a documentos, el contacto automáticamente esos documentos se muestran por
  // carpetas por negociaciones», más lo suyo que no cuelga de ninguna: «como importaciones y todo
  // eso… es la carpeta general, por así decirlo».
  //
  // 🔴 SE BUSCA POR `oportunidad_id`, NO RECORRIENDO EL ÁRBOL, y el motivo está medido: de las
  // carpetas de negociación que hay hoy, **6.935 cuelgan de `Trámites` y solo 282 de la carpeta
  // del contacto**. Las segundas son las que creó la migración a R2 (mig. `0046`/`0047`); las
  // primeras son todo lo anterior. Un endpoint que bajara desde la carpeta del contacto
  // funcionaría para 266 contactos y devolvería vacío para los otros treinta y un mil — y
  // devolver vacío se lee como «este cliente no tiene documentos», que es mentira.
  //
  // ⚠️ AUTORIZACIÓN: `requireAuth`, como el resto de endpoints de este módulo.
  // Aquí solo viajan METADATOS (nombre, tipo, tamaño); los BYTES los sirve
  // `/api/drive/files/:id/raw`, que sí comprueba la ACL de la carpeta. No se estrena una regla
  // nueva en un endpoint de listado.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  app.get("/api/contactos/:id/documentos", requireAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const contacto = (await query<any>(
      "SELECT id, nombre_completo FROM gozz.contactos_cache WHERE id = $1", [id]
    ))[0];
    if (!contacto) { res.status(404).json({ error: "Contacto no encontrado" }); return; }

    // Las negociaciones del contacto, con su carpeta si la tienen. `LEFT JOIN`: una negociación
    // sin carpeta es normal (nadie subió nada todavía) y tiene que salir igual, vacía.
    const negociaciones = await query<any>(
      `SELECT o.id, o.nombre_caso, o.etapa, f.id AS folder_id
         FROM gozz.oportunidades o
         LEFT JOIN gozz.drive_folders f
                ON f.tipo = 'opportunity' AND f.oportunidad_id = o.id AND f.deleted_at IS NULL
        WHERE o.contacto_id = $1
        ORDER BY o.created_at DESC NULLS LAST, o.id`,
      [id]
    );

    // Todos los archivos de golpe, cada uno etiquetado con el grupo al que pertenece.
    //
    // 🔴 `c.tipo <> 'opportunity'` en el paso recursivo NO es cosmético: en los 266 contactos que
    // sí tienen carpeta propia, las negociaciones cuelgan DE ELLA. Sin esa condición, bajar desde
    // la carpeta del contacto se tragaría las negociaciones enteras dentro de «General» y cada
    // archivo saldría DOS veces — una en su negociación y otra en el cajón de sastre.
    const archivos = await query<any>(
      `WITH RECURSIVE raices AS (
         SELECT f.id, f.oportunidad_id AS grupo
           FROM gozz.drive_folders f
           JOIN gozz.oportunidades o ON o.id = f.oportunidad_id
          WHERE f.tipo = 'opportunity' AND f.deleted_at IS NULL AND o.contacto_id = $1
         UNION ALL
         SELECT f.id, NULL::uuid AS grupo
           FROM gozz.drive_folders f
          WHERE f.tipo = 'contact' AND f.contacto_id = $1 AND f.deleted_at IS NULL
       ),
       sub AS (
         SELECT r.id, r.grupo FROM raices r
         UNION ALL
         SELECT c.id, s.grupo
           FROM gozz.drive_folders c
           JOIN sub s ON c.parent_id = s.id
          WHERE c.deleted_at IS NULL AND c.tipo <> 'opportunity'
       )
       SELECT df.id, df.nombre, df.mime, df.size_bytes, df.created_at, df.folder_id, sub.grupo
         FROM sub
         JOIN gozz.drive_files df ON df.folder_id = sub.id
        WHERE df.deleted_at IS NULL
        ORDER BY df.nombre, df.id`,
      [id]
    );

    const porGrupo = new Map<string, any[]>();
    for (const a of archivos) {
      const clave = a.grupo ? String(a.grupo) : "general";
      const arr = porGrupo.get(clave);
      const file = { id: a.id, nombre: a.nombre, mime: a.mime, size_bytes: a.size_bytes, created_at: a.created_at, folder_id: a.folder_id };
      if (arr) arr.push(file); else porGrupo.set(clave, [file]);
    }

    // Las negociaciones primero y en el orden en que ya se listan en la ficha; «General» al final,
    // que es donde la busca quien no la encontró en ninguna negociación.
    const grupos = negociaciones.map((n: any) => ({
      tipo: "negociacion" as const,
      oportunidad_id: n.id,
      nombre: n.nombre_caso || "(negociación sin nombre)",
      etapa: n.etapa,
      folder_id: n.folder_id,
      files: porGrupo.get(String(n.id)) ?? [],
    }));
    const general = porGrupo.get("general") ?? [];
    if (general.length > 0) {
      grupos.push({
        tipo: "general" as any,
        oportunidad_id: null as any,
        nombre: "General del contacto",
        etapa: null as any,
        folder_id: null as any,
        files: general,
      });
    }

    res.json({ grupos, total: archivos.length });
  });

  // Notas del contacto.
  app.get("/api/contactos/:id/notas", requireAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const locales = await query<any>(
      `SELECT n.id, n.contenido, n.archivos, n.created_at, n.updated_at, n.user_id,
              u.nombre AS user_nombre, u.foto_perfil_url AS user_foto
         FROM gozz.contactos_notas n
         LEFT JOIN gozz.users u ON u.id = n.user_id
        WHERE n.contacto_id = $1
        ORDER BY n.created_at DESC`,
      [id]
    );
    const notes: any[] = locales.map((n) => ({
      id: n.id, source: "local", contenido: n.contenido, archivos: Array.isArray(n.archivos) ? n.archivos : [],
      created_at: n.created_at, updated_at: n.updated_at,
      user_id: n.user_id, user_nombre: n.user_nombre, user_foto: n.user_foto, can_edit: true,
    }));
    res.json({ notes, total: notes.length });
  });

  app.post("/api/contactos/:id/notas", requireAuth, notasUpload.array("archivo"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const contenido = String(req.body?.contenido || "").trim();
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!contenido && files.length === 0) { res.status(400).json({ error: "Nota o archivo requerido" }); return; }
    const notaId = randomUUID();
    const archivos = files.map((f) => ({
      url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "contacto_nota", { contactoId: String(req.params.id), notaId }, f.filename),
      filename: f.originalname,
      mime: f.mimetype,
      size: f.size,
    }));
    const rows = await query<any>(
      `INSERT INTO gozz.contactos_notas (id, contacto_id, user_id, contenido, archivos)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [notaId, String(req.params.id), u.sub, contenido, JSON.stringify(archivos)]
    );
    res.json({ nota: rows[0] });
  });

  app.patch("/api/contactos/:id/notas/:notaId", requireAuth, notasUpload.array("archivo"), async (req: Request, res: Response) => {
    const u = (req as any).user;
    const contenido = String(req.body?.contenido || "").trim();
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    let keep: any[] = [];
    try { const k = JSON.parse(String(req.body?.archivos_keep ?? "[]")); if (Array.isArray(k)) keep = k; } catch { keep = []; }
    const nuevos = files.map((f) => ({ url: placeUploadedFile(path.join(UPLOADS_DIR, f.filename), "contacto_nota", { contactoId: String(req.params.id), notaId: String(req.params.notaId) }, f.filename), filename: f.originalname, mime: f.mimetype, size: f.size }));
    const archivos = [...keep, ...nuevos];
    if (!contenido && archivos.length === 0) { res.status(400).json({ error: "Contenido o archivo requerido" }); return; }
    const n = (await query<any>(`SELECT user_id, archivos FROM gozz.contactos_notas WHERE id = $1 AND contacto_id = $2`, [String(req.params.notaId), String(req.params.id)]))[0];
    if (!n) { res.status(404).json({ error: "Nota no encontrada" }); return; }
    const isAdmin = u.nivel === "admin" || u.nivel === "super_admin";
    if (n.user_id !== u.sub && !isAdmin) { res.status(403).json({ error: "Solo el autor puede editar" }); return; }
    const keepUrls = new Set(archivos.map((a: any) => a?.url));
    const quitados = (Array.isArray(n.archivos) ? n.archivos : []).map((a: any) => a?.url).filter((url: any) => typeof url === "string" && !keepUrls.has(url));
    const rows = await query<any>(`UPDATE gozz.contactos_notas SET contenido = $1, archivos = $2::jsonb, updated_at = NOW() WHERE id = $3 RETURNING *`, [contenido, JSON.stringify(archivos), String(req.params.notaId)]);
    res.json({ nota: rows[0] });
    deleteUploadsIfUnreferenced(quitados, { origen: "cascade_nota", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup contacto-nota-patch]", e?.message));
  });

  app.delete("/api/contactos/:id/notas/:notaId", requireAuth, async (req: Request, res: Response) => {
    const u = (req as any).user;
    const n = (await query<any>(`SELECT user_id, archivos FROM gozz.contactos_notas WHERE id = $1 AND contacto_id = $2`, [String(req.params.notaId), String(req.params.id)]))[0];
    if (!n) { res.status(404).json({ error: "Nota no encontrada" }); return; }
    const isAdmin = u.nivel === "admin" || u.nivel === "super_admin";
    if (n.user_id !== u.sub && !isAdmin) { res.status(403).json({ error: "Solo el autor o un admin puede eliminar" }); return; }
    await query(`DELETE FROM gozz.contactos_notas WHERE id = $1`, [String(req.params.notaId)]);
    res.json({ ok: true });
    deleteUploadsIfUnreferenced((Array.isArray(n.archivos) ? n.archivos : []).map((a: any) => a?.url), { origen: "cascade_nota", userId: (req as any).user?.sub }).catch((e) => console.error("[uploads-cleanup contacto-nota-del]", e?.message));
  });
}
