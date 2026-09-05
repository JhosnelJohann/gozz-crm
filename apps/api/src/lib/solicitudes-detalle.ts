// ============================================================================================
// DETALLE DE UNA SOLICITUD SOBRE UNA SELECCIÓN
//
// 🔴 EL PROBLEMA QUE CIERRA. La bandeja enseñaba "2 oportunidades → nuevo" y el motivo. Nada más.
// Quien aprueba no sabía CUÁLES eran esas dos, ni de qué clientes, ni de dónde venían — y su nombre
// queda firmando en `aprobador_id`. **Una aprobación sin visibilidad no es una aprobación: es un
// sello de goma**, y toda la arquitectura de solicitudes existe justamente para que alguien decida
// con criterio.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL ESTADO SE LEE AHORA, NO SE GUARDÓ
// ════════════════════════════════════════════════════════════════════════════════════════════
// Entre pedir y aprobar pueden pasar horas: alguien pudo mover una de esas oportunidades, dejarla
// sin un campo obligatorio o borrarla. El aprobador tiene que ver **el estado de hoy**, no la foto
// de ayer, y las diferencias respecto a lo que se pidió se marcan **explícitamente** en vez de
// dejarlas pasar. Lo que se omite en silencio es lo que acaba ejecutándose sin que nadie lo mirara.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// GENÉRICO POR TIPO, NO ESPECÍFICO DE ETAPA
// ════════════════════════════════════════════════════════════════════════════════════════════
// Las solicitudes de contactos que vienen —archivar y exportar— son también sobre una selección y
// van a necesitar exactamente esto. Por eso hay un REGISTRO por tipo: cada entrada dice de qué tabla
// sale la solicitud y **cómo se enriquece su selección**. Añadir un tipo es sumar una entrada, no
// reescribir el endpoint. El permiso sigue saliendo del `tipo` (`aprobar_<tipo>`, §10.3).
// ============================================================================================

import { query } from "../shared/db.js";
import { puede } from "./permisos.js";
import { normalizarCambios, previaCambioEtapa, type PreviaCambioEtapa } from "./oportunidades-etapa.js";

const SCHEMA = "gozz";

/** Una diferencia entre lo que se pidió y lo que hay hoy. `codigo` para la interfaz, `texto` para leer. */
export interface Discrepancia {
  codigo: "no_existe" | "cambio_de_estado" | "ya_en_destino" | "faltan_campos" | "destino_no_disponible";
  texto: string;
  /** Los campos que faltan, cuando el código es `faltan_campos`. */
  detalle?: string[];
}

/** Una fila de la selección, tal y como la ve quien va a aprobar. */
export interface ItemSolicitud {
  id: string;
  titulo: string | null;
  /** Lo que hace reconocible al registro: trámite, contacto, valor, responsable… */
  campos: { etiqueta: string; valor: string | null }[];
  /** Cómo está AHORA (etiqueta visible, no la clave). */
  actual: string | null;
  /** Qué se pidió para él. */
  solicitado: string | null;
  discrepancias: Discrepancia[];
}

export interface DetalleSolicitud {
  solicitud: Record<string, any>;
  items: ItemSolicitud[];
  /** Los efectos colaterales, RECALCULADOS ahora. Propio de cada tipo; puede no haber. */
  efectos?: PreviaCambioEtapa;
  /** Resumen para la confirmación: "1 de las 2 ya no está en la etapa que tenía cuando se pidió." */
  discrepancias: { total: number; resumen: { codigo: string; texto: string; n: number }[] };
}

interface Registro {
  /** De qué tabla sale la solicitud de este tipo. */
  tabla: string;
  /** Cómo se enriquece su selección. */
  enriquecer: (solicitud: any) => Promise<{ items: ItemSolicitud[]; efectos?: PreviaCambioEtapa }>;
}

// --------------------------------------------------------------------------------------------
// oportunidad_etapa
// --------------------------------------------------------------------------------------------

/**
 * ⚠️ VÍA DE RESPALDO — solo para las solicitudes ANTERIORES a que `cambios` guardara el origen.
 *
 * La forma nueva (`{desde, hasta}`) trae la etapa que había al pedirla, así que comparar es leer
 * dos valores. Esto reconstruye ese dato para las filas viejas, que guardaban solo el destino:
 * `gozz.auditoria` es inmutable (R10) y **todo cambio de etapa deja fila** con
 * `datos_antes.etapa`, así que la primera fila posterior a la solicitud lleva la etapa que había.
 *
 * 🔴 Es de respaldo, NO la vía principal, y por dos motivos: reconstruir depende de que nadie se
 * olvide de auditar —hubo dos caminos en el propio código que no lo hacían—, y un `UPDATE` a mano
 * en la base **no deja rastro**, así que esa discrepancia no se ve. La etapa actual sí es correcta
 * siempre, porque se lee de la tabla.
 *
 * Muere sola: cuando se resuelvan las solicitudes pendientes con la forma antigua, deja de
 * llamarse. No se migran esas filas —ver `MapaCambiosGuardado`—; se dejan morir.
 */
async function etapasAlPedir(ids: string[], desde: string): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const filas = await query<any>(
    `SELECT DISTINCT ON (registro_id) registro_id, datos_antes->>'etapa' AS etapa
       FROM ${SCHEMA}.auditoria
      WHERE tabla_afectada = 'oportunidades'
        AND registro_id = ANY($1::text[])
        AND created_at > $2::timestamptz
        AND datos_antes ? 'etapa'
      ORDER BY registro_id, created_at ASC`,
    [ids, desde]
  );
  return new Map(filas.filter((f: any) => f.etapa).map((f: any) => [String(f.registro_id), String(f.etapa)]));
}

const money = (v: any) => (Number(v) > 0 ? `$${Number(v).toFixed(0)}` : null);

async function enriquecerEtapa(solicitud: any): Promise<{ items: ItemSolicitud[]; efectos: PreviaCambioEtapa }> {
  // Las dos formas conviven: la nueva trae `{desde, hasta}`, la antigua solo el destino.
  const cambios = normalizarCambios(solicitud.cambios || {});
  const ids = Object.keys(cambios);

  // Lo que hace reconocible cada caso: lo mismo que vio quien la armó, para que los dos miren lo
  // mismo. Una sola consulta sobre el conjunto (§3.6).
  const filas = await query<any>(
    `SELECT o.id, o.nombre_caso, o.etapa, o.valor_total,
            c.nombre_completo AS contacto_nombre,
            tc.nombre AS tramite_nombre,
            u.nombre AS responsable_nombre
       FROM ${SCHEMA}.oportunidades o
       LEFT JOIN ${SCHEMA}.contactos_cache c ON c.id = o.contacto_id
       LEFT JOIN ${SCHEMA}.tramites_config tc ON tc.id = o.tipo_tramite_id
       LEFT JOIN ${SCHEMA}.users u ON u.id = o.preparador_id
      WHERE o.id = ANY($1::uuid[])`,
    [ids]
  );
  const porId = new Map(filas.map((f: any) => [String(f.id), f]));

  const etiquetas = new Map(
    (await query<any>(`SELECT key, label FROM ${SCHEMA}.pipeline_stages`)).map((s: any) => [String(s.key), String(s.label)])
  );
  const nombreEtapa = (key: string | null) => (key ? etiquetas.get(key) ?? key : null);

  // 🔴 El origen se LEE de la solicitud cuando está guardado. Solo se reconstruye desde `auditoria`
  // para las anteriores a ese cambio — y solo para ésas, para no pagar la consulta ni heredar su
  // incertidumbre cuando hay un dato registrado.
  const sinOrigenGuardado = ids.filter((id) => cambios[id].desde === null);
  const reconstruidas = sinOrigenGuardado.length
    ? await etapasAlPedir(sinOrigenGuardado, solicitud.created_at)
    : new Map<string, string>();
  const etapaAlPedir = (id: string) => cambios[id].desde ?? reconstruidas.get(id) ?? null;

  // Los efectos se RECALCULAN con la misma función que usa la previa del modal: quien aprueba es
  // quien ejecuta, así que tiene que ver lo mismo que vio quien lo pidió, pero con los números de
  // hoy. Reutilizada, no duplicada — si el cálculo cambia, cambia para los dos.
  const efectos = await previaCambioEtapa(cambios);
  const omitidasPorId = new Map(efectos.omitidas.map((o) => [o.id, o]));

  const items: ItemSolicitud[] = ids.map((id) => {
    const op = porId.get(id);
    const destino = cambios[id].hasta;
    const discrepancias: Discrepancia[] = [];

    if (!op) {
      // `oportunidades` no tiene archivado lógico: o está o no está. Si desapareció fue por el
      // `DELETE /api/oportunidades/:id` (solo admin). Se dice; no se omite en silencio.
      return {
        id,
        titulo: null,
        campos: [],
        actual: null,
        solicitado: nombreEtapa(destino),
        discrepancias: [{ codigo: "no_existe", texto: "esta oportunidad ya no existe" }],
      };
    }

    const previa = etapaAlPedir(id);
    if (previa && previa !== op.etapa) {
      discrepancias.push({
        codigo: "cambio_de_estado",
        texto: `cuando se pidió estaba en "${nombreEtapa(previa)}" y ahora está en "${nombreEtapa(op.etapa)}"`,
      });
    }
    if (op.etapa === destino) {
      discrepancias.push({ codigo: "ya_en_destino", texto: "ya está en la etapa solicitada: no hay nada que hacer con esta" });
    }
    const omitida = omitidasPorId.get(id);
    if (omitida?.motivo === "le faltan campos obligatorios") {
      discrepancias.push({
        codigo: "faltan_campos",
        texto: "le faltan campos obligatorios de la etapa solicitada, así que no se movería",
        detalle: omitida.faltan,
      });
    }
    if (omitida?.motivo === "la etapa de destino ya no está disponible") {
      discrepancias.push({ codigo: "destino_no_disponible", texto: "la etapa solicitada ya no está disponible" });
    }

    return {
      id,
      titulo: op.nombre_caso,
      campos: [
        { etiqueta: "Trámite", valor: op.tramite_nombre },
        { etiqueta: "Contacto", valor: op.contacto_nombre },
        { etiqueta: "Valor", valor: money(op.valor_total) },
        { etiqueta: "Responsable", valor: op.responsable_nombre },
      ],
      actual: nombreEtapa(op.etapa),
      solicitado: nombreEtapa(destino),
      discrepancias,
    };
  });

  return { items, efectos };
}

// --------------------------------------------------------------------------------------------
// El registro. Añadir un tipo = añadir una entrada.
// --------------------------------------------------------------------------------------------

export const REGISTRO_DETALLE: Record<string, Registro> = {
  oportunidad_etapa: { tabla: "oportunidad_etapa_solicitudes", enriquecer: enriquecerEtapa },
  // Pendientes, y esta es la puerta que les queda abierta:
  //   contacto_archivar / contacto_exportar → { tabla: 'contacto_solicitudes', enriquecer: … }
  //   Su selección es un `{modo:'ids'|'filtro'}`, así que su enriquecedor la resolverá con
  //   `resolverSeleccion` y devolverá los mismos `ItemSolicitud`. El endpoint no cambia.
};

/** Busca la solicitud en la tabla que le toque por tipo. `null` si no existe en ninguna. */
async function localizar(id: string): Promise<{ solicitud: any; tipo: string; registro: Registro } | null> {
  for (const [tipo, registro] of Object.entries(REGISTRO_DETALLE)) {
    const fila = (await query<any>(`SELECT * FROM ${SCHEMA}.${registro.tabla} WHERE id = $1`, [id]))[0];
    if (fila) return { solicitud: fila, tipo, registro };
  }
  return null;
}

export type ResultadoDetalle =
  | { ok: true; detalle: DetalleSolicitud }
  | { ok: false; motivo: "no_encontrada" | "sin_permiso" };

/**
 * El detalle completo, con el permiso comprobado.
 *
 * Lo ve **quien puede aprobar ese tipo** (`aprobar_<tipo>`, derivado — sin `switch`) **o quien la
 * pidió**. Nadie más: es una lista de casos con nombres de clientes, y el interés legítimo lo tiene
 * quien decide y quien pidió.
 */
export async function detalleSolicitud(
  solicitudId: string,
  userId: string | null | undefined
): Promise<ResultadoDetalle> {
  const encontrada = await localizar(solicitudId);
  if (!encontrada) return { ok: false, motivo: "no_encontrada" };
  const { solicitud, tipo, registro } = encontrada;

  const puedeAprobar = await puede(userId, `aprobar_${tipo}`);
  const esSuya = !!userId && String(solicitud.solicitante_id) === String(userId);
  if (!puedeAprobar && !esSuya) return { ok: false, motivo: "sin_permiso" };

  const { items, efectos } = await registro.enriquecer(solicitud);

  // El resumen agregado que la confirmación de aprobar tiene que enseñar: "1 de las 2 ya no está en
  // la etapa que tenía cuando se pidió". Sin él, aprobar sobre un conjunto envejecido es a ciegas.
  const porCodigo = new Map<string, { codigo: string; texto: string; n: number }>();
  for (const it of items) {
    for (const d of it.discrepancias) {
      const y = porCodigo.get(d.codigo);
      if (y) y.n += 1;
      else porCodigo.set(d.codigo, { codigo: d.codigo, texto: RESUMEN[d.codigo], n: 1 });
    }
  }
  const conAlguna = items.filter((i) => i.discrepancias.length > 0).length;

  const [solicitante] = await query<any>(
    `SELECT nombre, foto_perfil_url FROM ${SCHEMA}.users WHERE id = $1`, [solicitud.solicitante_id]
  );

  return {
    ok: true,
    detalle: {
      solicitud: {
        ...solicitud,
        tipo,
        solicitante_nombre: solicitante?.nombre ?? null,
        solicitante_foto: solicitante?.foto_perfil_url ?? null,
        puede_aprobar: puedeAprobar,
      },
      items,
      efectos,
      discrepancias: {
        total: conAlguna,
        resumen: [...porCodigo.values()].sort((a, b) => b.n - a.n),
      },
    },
  };
}

/** El texto del resumen agregado, uno por código. En plural implícito: lo acompaña el número. */
const RESUMEN: Record<string, string> = {
  no_existe: "ya no existen",
  cambio_de_estado: "ya no están en la etapa que tenían cuando se pidió",
  ya_en_destino: "ya están en la etapa solicitada",
  faltan_campos: "no se moverían: les faltan campos obligatorios",
  destino_no_disponible: "piden una etapa que ya no está disponible",
};
