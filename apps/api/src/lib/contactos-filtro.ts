// ============================================================================================
// FILTRO DEL LISTADO DE CONTACTOS — una sola definición, tres consumidores.
//
// 🔴 ESTE FICHERO ES UN TRASLADO, NO UN CAMBIO. El contenido venía TAL CUAL de
// `contactos-routes.ts`, donde era privado y por eso **no tenía ni una prueba**. Mismo movimiento
// que ya se hizo con `lib/oportunidades-filtro.ts` y `lib/seleccion.ts`: lo que decide QUÉ filas
// se ven no puede vivir escondido dentro de un fichero de rutas, porque entonces nadie lo puede
// ejercitar sin levantar un servidor.
// ============================================================================================

import { SIN_USUARIO, sqlFiltrosPapelera } from "./contactos-papelera.js";
import { sqlDuplicadosRevisables } from "./contactos-dedup.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Los contactos fusionados por la dedup (migración 0042) quedan con `archivado = true` y
// `fusionado_en_contacto_id` apuntando al ganador. NO deben aparecer en listados, búsquedas ni
// contadores: sus oportunidades, archivos y datos ya viven en el contacto que sobrevivió.
// (El detalle por id SÍ los sirve, para que un enlace viejo no dé 404.)
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 ESTE `COALESCE` ES FUNCIONAL. NO SE QUITA. NO ES SIMETRÍA CON LA RAMA DE ARCHIVADOS.
// ════════════════════════════════════════════════════════════════════════════════════════════
// Más abajo, la rama de la papelera usa `archivado = true` SIN COALESCE (ver el porqué allí).
// Esa asimetría parece un descuido y no lo es: la equivalencia solo se cumple en UN sentido,
// porque `contactos_cache.archivado` es `boolean DEFAULT false` **sin NOT NULL** (mig. 0042) y
// por tanto admite NULL.
//
//   Expresión                             │ una fila con `archivado IS NULL`
//   ──────────────────────────────────────┼──────────────────────────────────
//   COALESCE(archivado, false) = false    │ la INCLUYE   ← lo que queremos
//   archivado = false                     │ la EXCLUYE   (NULL = false → NULL, y WHERE lo descarta)
//   COALESCE(archivado, false) = true     │ la excluye
//   archivado = true                      │ la excluye   ← idénticos, por eso allí sí se puede
//
// Quitar el COALESCE de AQUÍ haría que cualquier contacto con `archivado IS NULL` desapareciera
// del listado principal, de la búsqueda y de los contadores **sin lanzar ningún error**. Es
// exactamente la clase de fallo silencioso que este módulo existe para evitar. Hoy hay 0 filas
// NULL, así que el riesgo es latente: la idea es que siga siéndolo.
//
// Hay un test que lo vigila (`tests/contactos-archivado-null.test.ts`): inserta un contacto con
// `archivado = NULL` explícito y exige que salga en el listado normal. Se pone rojo el día que
// alguien "normalice" esta línea.
//
// Lo mismo vale para el otro `COALESCE(archivado, false) = false` del proyecto, en `index.ts`.
// Tampoco se toca.
//
// Se EXPORTA solo para que la prueba pueda ejercitar esta misma cadena y no una copia suya.
export const NO_ARCHIVADOS = `COALESCE(archivado, false) = false`;

/**
 * La cara opuesta: la papelera. 🔴 SIN `COALESCE`, y es deliberado.
 *
 * Aquí SÍ se puede quitar porque `archivado = true` y `COALESCE(archivado, false) = true`
 * seleccionan exactamente las mismas filas: para una fila con `archivado IS NULL`, `NULL = true`
 * da NULL y el `WHERE` la descarta igual que hacía `false = true`. Medido sobre la base local:
 * 27.805 filas por las dos vías y **0 filas donde difieran**.
 *
 * Lo que cambia es que el índice parcial `idx_contactos_archivado_at` (mig. `0056`) pasa a ser
 * ELEGIBLE. Su predicado es `WHERE archivado = true AND archivado_at IS NOT NULL`, y el probador
 * de implicaciones de Postgres **no sabe deducir `archivado = true` a través de un `COALESCE`**:
 * no es que descartara el índice por coste, es que no podía usarlo. Llevaba desde su creación sin
 * servir para nada. Con el cambio, filtrar la papelera por rango de fechas pasa de `Seq Scan` a
 * `Index Scan`.
 */
export const SOLO_ARCHIVADOS = `archivado = true`;
// ============================================================================================
// FILTRO DEL LISTADO — una sola definición, tres consumidores.
//
// El listado paginado, el resolutor de "seleccionar el total" y las acciones masivas usan
// EXACTAMENTE el mismo WHERE porque solo existe uno. Eso es lo que hace que el `total` no pueda
// mentir: si el contador y los items se construyeran por separado, "seleccionar los N" acabaría
// actuando sobre un conjunto distinto del que el usuario vio.
// ============================================================================================

export interface FiltrosContactos {
  q?: string;
  estado?: string;
  tipo_cliente?: string;
  tramite?: string;
  source?: string;          // pipedrive | zoho | bitrix | native
  archivados?: boolean;     // opt-in admin: ver la papelera en vez del listado normal
  motivo?: string;          // papelera: separa lo archivado a mano de lo que arrastró una corrida
  usuario?: string;         // papelera: uuid de quien archivó, o SIN_USUARIO
  desde?: string;           // papelera: rango sobre archivado_at (ISO)
  hasta?: string;
  revision_dedup?: boolean; // solo los candidatos a duplicado que el motor dejó para ojo humano
  /**
   * uuid del responsable, o `SIN_RESPONSABLE` para los que no tienen ninguno.
   *
   * 🔴 VA AQUÍ Y NO EN LA CONSULTA DEL LISTADO, y no es una preferencia de estilo: el contador, la
   * página y `resolverSeleccion` comparten este WHERE **a propósito**. Si este filtro se colara por
   * otra vía, el número de "Seleccionar el total (N)" describiría un conjunto y la acción masiva
   * actuaría sobre otro. Es la invariante de todo el módulo.
   */
  responsable?: string;
  /**
   * Solo los contactos SIN fecha de nacimiento.
   *
   * Es la pieza que sustituye a un aviso al guardar. Hoy 3.704 de 3.811 contactos vivos no la
   * tienen —el 97,2 %—, asi que un aviso saltaria en 97 de cada 100 fichas y en una semana nadie
   * lo leeria (§10.7). Un filtro, en cambio, deja LISTARLOS, repartirlos con la accion masiva de
   * responsable que ya existe, y ver bajar el numero.
   */
  sin_fecha_nacimiento?: boolean;
}

/**
 * Los que **no tienen responsable asignado**. Se enseña el hueco en vez de esconderlo: son
 * justamente los que hay que repartir, y sin esta opción no habría forma de encontrarlos.
 * Mismo criterio que `SIN_USUARIO` en la papelera y `SIN_TRAMITE` en oportunidades.
 */
export const SIN_RESPONSABLE = "sin_responsable";

/** Una fecha ISO utilizable, o nada. Mismo criterio que el `parseFecha` de la papelera del Drive. */
export const fechaValida = (v: any): string | undefined => {
  const s = String(v ?? "").trim();
  return s && !isNaN(Date.parse(s)) ? s : undefined;
};

/** Normaliza los filtros vengan de query string (GET) o del body (POST de acciones masivas). */
export function leerFiltros(src: any): FiltrosContactos {
  return {
    q: String(src?.q ?? "").trim() || undefined,
    estado: String(src?.estado ?? "").trim() || undefined,
    tipo_cliente: String(src?.tipo_cliente ?? "").trim() || undefined,
    tramite: String(src?.tramite ?? "").trim() || undefined,
    source: String(src?.source ?? "").trim() || undefined,
    archivados: ["1", "true", "yes"].includes(String(src?.archivados ?? "").toLowerCase()) || src?.archivados === true,
    motivo: String(src?.motivo ?? "").trim() || undefined,
    // Mismos nombres de parámetro que la papelera del Drive (`usuario` / `desde` / `hasta`), para
    // que las dos pantallas se lean igual. Se validan aquí: lo que no es un uuid o una fecha
    // reconocible se descarta en silencio en vez de llegar al SQL.
    usuario: (() => {
      const v = String(src?.usuario ?? "").trim();
      return v === SIN_USUARIO || UUID_RE.test(v) ? v : undefined;
    })(),
    desde: fechaValida(src?.desde),
    hasta: fechaValida(src?.hasta),
    revision_dedup: ["1", "true", "yes"].includes(String(src?.revision_dedup ?? "").toLowerCase()) || src?.revision_dedup === true,
    // Mismo criterio de validación que `usuario`: un uuid o el valor especial. Lo que no encaja se
    // descarta en silencio en vez de llegar al SQL.
    responsable: (() => {
      const v = String(src?.responsable ?? "").trim();
      return v === SIN_RESPONSABLE || UUID_RE.test(v) ? v : undefined;
    })(),
    // Mismo trato que `archivados` y `revision_dedup`: una bandera, no un valor.
    sin_fecha_nacimiento: ["1", "true", "yes"].includes(String(src?.sin_fecha_nacimiento ?? "").toLowerCase()) || src?.sin_fecha_nacimiento === true,
  };
}

/** Construye el WHERE + params. `desde` permite continuar la numeración de $n del llamador. */
export function construirFiltroContactos(f: FiltrosContactos, desde = 0): { where: string; params: any[] } {
  const params: any[] = [];
  const addP = (v: any) => { params.push(v); return `$${desde + params.length}`; };
  // ⚠️ Las dos ramas NO son simétricas y eso es correcto: la de archivados va sin `COALESCE` y la
  // de no-archivados lo necesita. El porqué, con la tabla de verdad, está en las dos constantes.
  const wheres: string[] = [f.archivados ? SOLO_ARCHIVADOS : NO_ARCHIVADOS];
  if (f.q) {
    // C7: además de nombre/email/teléfono, también whatsapp y a_number — dos de los datos por los
    // que más se busca a una persona. Sin índice a propósito (R8): medido, cuesta ~20 ms.
    const p = addP(`%${f.q}%`);
    wheres.push(`(nombre_completo ILIKE ${p} OR email ILIKE ${p} OR telefono ILIKE ${p} OR whatsapp ILIKE ${p} OR a_number ILIKE ${p})`);
  }
  if (f.estado) wheres.push(`direccion_estado = ${addP(f.estado)}`);
  if (f.tipo_cliente) wheres.push(`tipo_cliente = ${addP(f.tipo_cliente)}`);
  if (f.tramite) {
    const p = addP(f.tramite);
    wheres.push(`(estatus_migratorio_tipo = ${p} OR pipedrive_tramites @> ARRAY[${p}]::text[] OR zoho_tramites @> ARRAY[${p}]::text[])`);
  }
  if (f.source === "pipedrive") wheres.push(`pipedrive_person_id IS NOT NULL`);
  if (f.source === "zoho") wheres.push(`zoho_id IS NOT NULL`);
  if (f.source === "bitrix") wheres.push(`bitrix_contact_id IS NOT NULL`);
  if (f.source === "native") wheres.push(`pipedrive_person_id IS NULL AND zoho_id IS NULL AND bitrix_contact_id IS NULL`);
  // Papelera: motivo, autor y rango de fechas. Las cláusulas viven en `lib/contactos-papelera.ts`
  // —una sola definición, que es la que prueban los tests— y se componen aquí, en el constructor
  // único, para que listado, contador y selección masiva compartan WHERE. Solo con `archivados=1`:
  // en el listado normal el motivo es NULL y no hay fecha de archivado que filtrar.
  if (f.archivados) wheres.push(...sqlFiltrosPapelera(f, addP));
  // Candidatos a duplicado que el motor automático NO fusionó porque tenían nombres distintos y
  // dejó marcados esperando ojo humano. Es el flujo "supongamos que estos dos Pedro son el mismo",
  // pero con los candidatos ya detectados por el sistema en vez de cazarlos a mano.
  // D2 y D4 van dentro de `sqlDuplicadosRevisables` (lib/contactos-dedup.ts) para que exista UNA
  // definición: el listado, el contador de la cabecera y la selección masiva pasan todos por aquí,
  // y las pruebas ejercitan ese mismo código.
  if (f.revision_dedup) wheres.push(...sqlDuplicadosRevisables(addP));
  // Responsable. `SIN_RESPONSABLE` es una opción propia, no la ausencia de filtro: son los que hay
  // que repartir, y sin ella no se pueden encontrar.
  if (f.responsable === SIN_RESPONSABLE) wheres.push(`responsable_user_id IS NULL`);
  else if (f.responsable) wheres.push(`responsable_user_id = ${addP(f.responsable)}::uuid`);
  // Los que no tienen fecha de nacimiento. Sin indice a proposito (R8): es un IS NULL sobre 3.811
  // filas vivas. Si algun dia se mide y duele, se anade con su EXPLAIN delante y no antes.
  if (f.sin_fecha_nacimiento) wheres.push(`fecha_nacimiento IS NULL`);
  return { where: wheres.join(" AND "), params };
}
