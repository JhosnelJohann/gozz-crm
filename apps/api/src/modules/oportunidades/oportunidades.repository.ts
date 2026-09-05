// Único lugar del slice de oportunidades con acceso directo a SQL para el CRUD básico. La
// consulta de listado (con sus filtros/paginación) sigue viviendo en `lib/oportunidades-filtro.ts`
// —ya es un módulo de servicio propio, con test dedicado— y este repositorio no la duplica.
import { query } from "../../shared/db.js";

export async function getSlaDias(tipoTramiteId: string): Promise<number | null> {
  const rows = await query<{ sla_dias: number | null }>(
    "SELECT sla_dias FROM gozz.tramites_config WHERE id = $1",
    [tipoTramiteId]
  );
  return rows[0]?.sla_dias ?? null;
}

export interface NuevaOportunidad {
  contacto_id: string | null | undefined;
  nombre_caso: string;
  tipo_tramite_id: string | null | undefined;
  etapa: string | undefined;
  preparador_id: string | null | undefined;
  vendedor_id: string | null | undefined;
  valor_total: number | undefined;
  slaFechaLimite: Date | null;
  notas: string | null | undefined;
  manager_ventas_id: string | null;
  manager_preparacion_id: string | null;
  manager_general_id: string | null;
}

export async function insertOportunidad(d: NuevaOportunidad): Promise<any> {
  const rows = await query<any>(
    `INSERT INTO gozz.oportunidades (contacto_id, nombre_caso, tipo_tramite_id, etapa, preparador_id, vendedor_id, valor_total, balance_pendiente, sla_fecha_limite, notas, manager_ventas_id, manager_preparacion_id, manager_general_id)
     VALUES ($1, $2, $3, COALESCE($4, 'nuevo'), $5, $6, $7, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [d.contacto_id, d.nombre_caso, d.tipo_tramite_id, d.etapa, d.preparador_id, d.vendedor_id, d.valor_total || 0, d.slaFechaLimite, d.notas, d.manager_ventas_id, d.manager_preparacion_id, d.manager_general_id]
  );
  return rows[0];
}

export async function insertTramiteExtra(oportunidadId: string, tipoTramiteId: string): Promise<void> {
  await query(
    `INSERT INTO gozz.oportunidad_tramites (oportunidad_id, tipo_tramite_id, es_principal, origen)
     VALUES ($1, $2, false, 'manual') ON CONFLICT (oportunidad_id, tipo_tramite_id) DO NOTHING`,
    [oportunidadId, tipoTramiteId]
  );
}

export async function insertNotaInicial(oportunidadId: string, userId: string | null, contenido: string): Promise<void> {
  await query(
    `INSERT INTO gozz.oportunidades_notas (oportunidad_id, user_id, contenido)
     VALUES ($1, $2, $3)`,
    [oportunidadId, userId, contenido]
  );
}

export async function getEtapaActual(oportunidadId: string): Promise<string | null> {
  const rows = await query<{ etapa: string }>("SELECT etapa FROM gozz.oportunidades WHERE id = $1", [oportunidadId]);
  return rows[0]?.etapa ?? null;
}

export async function getValorActual(oportunidadId: string): Promise<number | null> {
  const rows = await query<{ valor_total: number }>("SELECT valor_total FROM gozz.oportunidades WHERE id = $1", [oportunidadId]);
  return rows[0]?.valor_total ?? null;
}

export async function updateOportunidad(id: string, fields: string[], values: any[]): Promise<any> {
  const set = fields.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const rows = await query<any>(
    `UPDATE gozz.oportunidades SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0];
}

export async function insertAuditoria(
  userId: string | null,
  accion: string,
  registroId: string,
  datosAntes: unknown,
  datosDespues: unknown
): Promise<void> {
  await query(
    `INSERT INTO gozz.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
     VALUES ($1, $2, 'oportunidades', $3, $4::jsonb, $5::jsonb)`,
    [userId, accion, registroId, JSON.stringify(datosAntes), JSON.stringify(datosDespues)]
  );
}

/** Recolecta las URLs de archivo colgadas de la oportunidad, ANTES del DELETE (cascade en BD). */
export async function collectArchivoUrls(oportunidadId: string): Promise<string[]> {
  const urls: string[] = [];

  const notas = await query<any>("SELECT archivos FROM gozz.oportunidades_notas WHERE oportunidad_id = $1", [oportunidadId]);
  for (const n of notas) for (const a of (Array.isArray(n.archivos) ? n.archivos : [])) if (a?.url) urls.push(a.url);

  const pagos = await query<any>(
    "SELECT comprobante_url, firma_autorizacion_url, comprobantes_urls, documentos_adicionales FROM gozz.oportunidades_pagos WHERE oportunidad_id = $1",
    [oportunidadId]
  );
  for (const p of pagos) {
    if (p.comprobante_url) urls.push(p.comprobante_url);
    if (p.firma_autorizacion_url) urls.push(p.firma_autorizacion_url);
    for (const c of (Array.isArray(p.comprobantes_urls) ? p.comprobantes_urls : [])) if (c?.url) urls.push(c.url);
    for (const d of (Array.isArray(p.documentos_adicionales) ? p.documentos_adicionales : [])) if (d?.url) urls.push(d.url);
  }

  const sols = await query<any>("SELECT comprobante_propuesto FROM gozz.oportunidad_pago_solicitudes WHERE oportunidad_id = $1", [oportunidadId]);
  for (const s of sols) if (s?.comprobante_propuesto?.url) urls.push(s.comprobante_propuesto.url);

  const opRow = (await query<any>("SELECT documentos FROM gozz.oportunidades WHERE id = $1", [oportunidadId]))[0];
  for (const h of (Array.isArray(opRow?.documentos?.historial_analisis) ? opRow.documentos.historial_analisis : [])) {
    if (h?.file?.url) urls.push(h.file.url);
  }

  return urls;
}

export async function deleteOportunidad(id: string): Promise<void> {
  await query("DELETE FROM gozz.oportunidades WHERE id = $1", [id]);
}
