import { query } from "../../shared/db.js";
import { puedeEditarMontoDirecto } from "../../lib/permisos.js";
import {
  PAGE_SIZES_OPORTUNIDADES,
  consultarOportunidades,
  leerFiltrosOportunidades,
} from "../../lib/oportunidades-filtro.js";
import { recomputeBalance } from "../../lib/oportunidad-balance.js";
import { deleteUploadsIfUnreferenced } from "../../lib/uploads-cleanup.js";
import { desarchivarAutomatico } from "../../lib/contactos-archivado.js";
import { runStageAutomations, validarCamposObligatorios } from "../../pipeline-routes.js";
import { asignarPuntosSiGanada } from "../../reportes-routes.js";
import * as repo from "./oportunidades.repository.js";
import type { z } from "zod";
import type { OportunidadSchema } from "./oportunidades.schemas.js";

type OportunidadInput = z.infer<typeof OportunidadSchema>;
type OportunidadUpdate = Partial<OportunidadInput>;

export { PAGE_SIZES_OPORTUNIDADES };

export interface OpcionesListado {
  userId: string | null;
  query: Record<string, any>;
}

export async function listar(opts: OpcionesListado) {
  const filtros = leerFiltrosOportunidades(opts.query);
  const q = opts.query;

  const paginando = q.page != null || q.pageSize != null;
  let page: number | undefined, pageSize: number | undefined;
  if (paginando) {
    // Lista blanca estricta, no clamp: un clamp silencioso convierte pageSize=100000 en 100 sin
    // avisar, y este endpoint existe precisamente para dejar de recortar sin decirlo.
    pageSize = q.pageSize === undefined ? 50 : Number(q.pageSize);
    if (!PAGE_SIZES_OPORTUNIDADES.includes(pageSize)) {
      return { error: `pageSize inválido: solo se admite ${PAGE_SIZES_OPORTUNIDADES.join(", ")}` as const };
    }
    page = Math.max(1, parseInt(String(q.page ?? "1"), 10) || 1);
  }

  const resultado = await consultarOportunidades(query, {
    filtros,
    userId: opts.userId,
    muestreo: {
      estado: String(q.estado || ""),
      terminalLimit: q.terminal_limit != null ? Math.max(0, Math.min(Number(q.terminal_limit) || 0, 2000)) : null,
      hardLimit: q.limit != null ? Math.max(1, Math.min(Number(q.limit) || 0, 5000)) : null,
    },
    page, pageSize,
  });
  return { resultado };
}

export async function crear(d: OportunidadInput, userId: string | null, tramitesExtraRaw: unknown) {
  let slaFechaLimite: Date | null = null;
  if (d.tipo_tramite_id) {
    const slaDias = await repo.getSlaDias(d.tipo_tramite_id);
    if (slaDias) {
      slaFechaLimite = new Date();
      slaFechaLimite.setDate(slaFechaLimite.getDate() + slaDias);
    }
  }

  const oportunidad = await repo.insertOportunidad({
    contacto_id: d.contacto_id,
    nombre_caso: d.nombre_caso,
    tipo_tramite_id: d.tipo_tramite_id,
    etapa: d.etapa,
    preparador_id: d.preparador_id,
    vendedor_id: d.vendedor_id,
    valor_total: d.valor_total,
    slaFechaLimite,
    notas: d.notas,
    manager_ventas_id: (d as any).manager_ventas_id || null,
    manager_preparacion_id: (d as any).manager_preparacion_id || null,
    manager_general_id: (d as any).manager_general_id || null,
  });

  // Leads→Clientes: un contacto con oportunidad es cliente → desarchivar si estaba archivado
  // (limpieza de leads). Pero SOLO si lo archivó un proceso: un contacto que una persona eliminó
  // a mano NO revive por esto; queda archivado y el intento se registra en auditoria.
  if (d.contacto_id) {
    await desarchivarAutomatico(String(d.contacto_id), { origen: "crear_oportunidad", userId });
  }

  // Trámites adicionales (multi): el principal va en tipo_tramite_id; los extra a la junction.
  const tramitesExtra: string[] = Array.isArray(tramitesExtraRaw)
    ? tramitesExtraRaw.filter((x: any) => typeof x === "string" && x && x !== d.tipo_tramite_id)
    : [];
  for (const tid of [...new Set(tramitesExtra)]) {
    await repo.insertTramiteExtra(oportunidad.id, tid).catch((e) => console.error("[oportunidad tramite extra]", e?.message));
  }

  // La observación escrita al crear la oportunidad se guarda también como primera nota,
  // para que sea visible en la pestaña Notas (donde el equipo la busca), no solo en la columna.
  const obsInicial = (d.notas || "").trim();
  if (obsInicial) {
    await repo.insertNotaInicial(oportunidad.id, userId, obsInicial).catch((e) => console.error("[oportunidad nota inicial]", e?.message));
  }

  return oportunidad;
}

export type ActualizarError = { status: number; error: string; missing?: string[] };
export type ActualizarResultado =
  | { tipo: "sin_cambios" }
  | { tipo: "error"; error: ActualizarError }
  | { tipo: "ok"; oportunidad: any };

export async function actualizar(
  id: string,
  d: OportunidadUpdate,
  userId: string | null
): Promise<ActualizarResultado> {
  const fields = Object.keys(d);
  if (fields.length === 0) return { tipo: "sin_cambios" };

  // GATE: cambiar el monto requiere permiso (admin/super_admin o user_permisos 'editar_monto').
  // Sin permiso, el usuario debe usar "Solicitar cambio de monto".
  if (d.valor_total !== undefined && !(await puedeEditarMontoDirecto({ sub: userId } as any))) {
    return { tipo: "error", error: { status: 403, error: "No tienes permiso para cambiar el monto. Usa 'Solicitar cambio de monto'." } };
  }

  // si cambia etapa, validar campos obligatorios definidos en pipeline_stages
  let prevEtapa: string | null = null;
  if (d.etapa) {
    const missing = await validarCamposObligatorios(id, String(d.etapa));
    if (missing.length > 0) {
      return { tipo: "error", error: { status: 400, error: "Campos obligatorios faltantes", missing } };
    }
    prevEtapa = await repo.getEtapaActual(id);
  }

  // capturar monto anterior para auditar el cambio de valor_total
  let prevValor: number | null = null;
  if (d.valor_total !== undefined) {
    prevValor = await repo.getValorActual(id);
  }

  const values = fields.map((k) => (d as any)[k]);
  const oportunidad = await repo.updateOportunidad(id, fields, values);

  // Si cambió el valor_total, recalcular el balance con el helper central (valor - descuentos - pagos).
  if (d.valor_total !== undefined && oportunidad) {
    const { balance } = await recomputeBalance(id);
    oportunidad.balance_pendiente = balance;
  }

  // Auditar cambio de monto (antes solo se auditaba la etapa)
  if (d.valor_total !== undefined && oportunidad && Number(prevValor) !== Number(d.valor_total)) {
    repo.insertAuditoria(
      userId, `Cambió el monto de ${prevValor} a ${d.valor_total}`, id,
      { valor_total: prevValor }, { valor_total: d.valor_total }
    ).catch((e) => console.error("[auditoria monto]", e?.message));
  }

  // Dispara automations fire-and-forget si cambió etapa
  if (d.etapa && oportunidad) {
    runStageAutomations(oportunidad.id, d.etapa, userId ?? undefined).catch((e) => console.error("[automations trigger]", e?.message));
    asignarPuntosSiGanada(oportunidad.id, d.etapa).catch((e) => console.error("[puntos trigger]", e?.message));
  }

  // Registrar en Actividad (auditoria) el cambio de etapa — incluye Finalizar (Ganado/Perdido)
  if (d.etapa && oportunidad && prevEtapa !== d.etapa) {
    const accion = d.etapa === "ganado" ? "Finalizó la oportunidad como GANADA"
      : d.etapa === "perdido" ? "Finalizó la oportunidad como PERDIDA"
      : `Cambió la etapa a "${d.etapa}"`;
    repo.insertAuditoria(userId, accion, id, { etapa: prevEtapa }, { etapa: d.etapa })
      .catch((e) => console.error("[auditoria oportunidad]", e?.message));
  }

  return { tipo: "ok", oportunidad };
}

export async function eliminar(id: string, userId: string | undefined): Promise<void> {
  // Recolectar TODAS las urls de archivos de la oportunidad y sus hijos ANTES del DELETE (cascade en BD).
  const urls = await repo.collectArchivoUrls(id);
  await repo.deleteOportunidad(id);
  deleteUploadsIfUnreferenced(urls, { origen: "cascade_oportunidad", userId }).catch((e) => console.error("[uploads-cleanup oportunidad]", e?.message));
}
