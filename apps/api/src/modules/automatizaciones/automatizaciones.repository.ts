// Único lugar del slice con acceso directo a SQL — mismo patrón que whatsapp.repository.ts.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query } from "../../shared/db.js";
import type { AgenteIA, AutomatizacionRegla, Recordatorio, RecordatorioCanal } from "@gozz/shared-types";

// ---------------------------------------------------------------------------
// Agentes de IA (gozz.users con es_agente_ia = true)
// ---------------------------------------------------------------------------

const AGENTE_COLUMNS = "id, nombre, email, n8n_webhook_url, activo, created_at";

export async function listAgentesIA(): Promise<AgenteIA[]> {
  return query<AgenteIA>(`SELECT ${AGENTE_COLUMNS} FROM gozz.users WHERE es_agente_ia = true ORDER BY nombre`);
}

export async function getAgenteIA(id: string): Promise<AgenteIA | null> {
  const rows = await query<AgenteIA>(`SELECT ${AGENTE_COLUMNS} FROM gozz.users WHERE id = $1 AND es_agente_ia = true`, [id]);
  return rows[0] ?? null;
}

/** Un agente de IA nunca inicia sesión — se le pone un hash de un secreto aleatorio que nadie
 * conoce, en vez de relajar `password_hash` a NULL (evita tocar una columna de seguridad que otro
 * código pueda asumir siempre presente). */
export async function crearAgenteIA(nombre: string, email: string, n8nWebhookUrl: string | null): Promise<AgenteIA> {
  const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);
  const rows = await query<AgenteIA>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, es_agente_ia, n8n_webhook_url)
     VALUES ($1, $2, $3, 'usuario', true, $4)
     RETURNING ${AGENTE_COLUMNS}`,
    [email.trim().toLowerCase(), passwordHash, nombre.trim(), n8nWebhookUrl]
  );
  return rows[0];
}

export async function actualizarAgenteIA(
  id: string,
  d: { nombre?: string; n8nWebhookUrl?: string | null; activo?: boolean }
): Promise<AgenteIA | null> {
  // `n8n_webhook_url` puede querer ponerse explícitamente en null (desconectar el agente de n8n
  // sin desactivarlo) — un COALESCE simple no distinguiría eso de "no lo mandaron". Se usa un
  // flag de "vino en el body" para decidir si se toca la columna, igual que en automatizaciones
  // .repository.ts#actualizarRegla con etapa_id/tag_id.
  const rows = await query<AgenteIA>(
    `UPDATE gozz.users SET
       nombre = COALESCE($2, nombre),
       n8n_webhook_url = CASE WHEN $3 THEN $4 ELSE n8n_webhook_url END,
       activo = COALESCE($5, activo)
     WHERE id = $1 AND es_agente_ia = true
     RETURNING ${AGENTE_COLUMNS}`,
    [id, d.nombre ?? null, d.n8nWebhookUrl !== undefined, d.n8nWebhookUrl ?? null, d.activo ?? null]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reglas (gozz.whatsapp_automatizaciones)
// ---------------------------------------------------------------------------

export async function listReglas(): Promise<AutomatizacionRegla[]> {
  return query<AutomatizacionRegla>("SELECT * FROM gozz.whatsapp_automatizaciones ORDER BY created_at DESC");
}

export interface NuevaRegla {
  nombre: string;
  etapaId: string | null;
  tagId: string | null;
  agenteId: string;
  asignarConversacion: boolean;
}

export async function crearRegla(d: NuevaRegla): Promise<AutomatizacionRegla> {
  const rows = await query<AutomatizacionRegla>(
    `INSERT INTO gozz.whatsapp_automatizaciones (nombre, etapa_id, tag_id, agente_id, asignar_conversacion)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [d.nombre.trim(), d.etapaId, d.tagId, d.agenteId, d.asignarConversacion]
  );
  return rows[0];
}

export async function actualizarRegla(
  id: string,
  d: Partial<NuevaRegla> & { activa?: boolean }
): Promise<AutomatizacionRegla | null> {
  const rows = await query<AutomatizacionRegla>(
    `UPDATE gozz.whatsapp_automatizaciones SET
       nombre = COALESCE($2, nombre),
       etapa_id = CASE WHEN $3 THEN $4 ELSE etapa_id END,
       tag_id = CASE WHEN $5 THEN $6 ELSE tag_id END,
       agente_id = COALESCE($7, agente_id),
       asignar_conversacion = COALESCE($8, asignar_conversacion),
       activa = COALESCE($9, activa)
     WHERE id = $1
     RETURNING *`,
    [
      id, d.nombre ?? null,
      d.etapaId !== undefined, d.etapaId ?? null,
      d.tagId !== undefined, d.tagId ?? null,
      d.agenteId ?? null, d.asignarConversacion ?? null, d.activa ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function eliminarRegla(id: string): Promise<void> {
  await query("DELETE FROM gozz.whatsapp_automatizaciones WHERE id = $1", [id]);
}

export interface ReglaConAgente extends AutomatizacionRegla {
  agente_nombre: string;
  agente_webhook_url: string | null;
  agente_activo: boolean;
}

/**
 * Busca la regla activa más específica que aplica a una conversación (por su etapa actual y sus
 * etiquetas). `etapa_id`/`tag_id` NULL en la regla = comodín. Se prefiere la regla que exige MÁS
 * condiciones (etapa Y etiqueta) sobre la que exige solo una, para que una regla general no tape
 * a una más puntual creada después.
 */
export async function buscarReglaParaConversacion(etapaId: string | null, tagIds: string[]): Promise<ReglaConAgente | null> {
  const rows = await query<ReglaConAgente>(
    `SELECT a.*, u.nombre AS agente_nombre, u.n8n_webhook_url AS agente_webhook_url, u.activo AS agente_activo
     FROM gozz.whatsapp_automatizaciones a
     JOIN gozz.users u ON u.id = a.agente_id
     WHERE a.activa = true
       AND (a.etapa_id IS NULL OR a.etapa_id = $1)
       AND (a.tag_id IS NULL OR a.tag_id = ANY($2::uuid[]))
     ORDER BY (a.etapa_id IS NOT NULL)::int + (a.tag_id IS NOT NULL)::int DESC, a.created_at ASC
     LIMIT 1`,
    [etapaId, tagIds]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Recordatorios (gozz.whatsapp_recordatorios)
// ---------------------------------------------------------------------------

export interface NuevoRecordatorio {
  canal: RecordatorioCanal;
  conversacionId: string | null;
  contactoId: string | null;
  buzonId: string | null;
  asunto: string | null;
  mensaje: string;
  programadoPara: string;
  creadoPor: string;
}

export async function listRecordatorios(): Promise<Recordatorio[]> {
  return query<Recordatorio>("SELECT * FROM gozz.whatsapp_recordatorios ORDER BY programado_para DESC LIMIT 200");
}

export async function crearRecordatorio(d: NuevoRecordatorio): Promise<Recordatorio> {
  const rows = await query<Recordatorio>(
    `INSERT INTO gozz.whatsapp_recordatorios
       (canal, conversacion_id, contacto_id, buzon_id, asunto, mensaje, programado_para, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [d.canal, d.conversacionId, d.contactoId, d.buzonId, d.asunto, d.mensaje, d.programadoPara, d.creadoPor]
  );
  return rows[0];
}

/** Solo cancela lo que todavía no se envió — una vez enviado, el registro queda como historial. */
export async function cancelarRecordatorio(id: string): Promise<boolean> {
  const rows = await query("DELETE FROM gozz.whatsapp_recordatorios WHERE id = $1 AND enviado_at IS NULL RETURNING id", [id]);
  return rows.length > 0;
}

export async function listRecordatoriosPendientes(): Promise<Recordatorio[]> {
  return query<Recordatorio>(
    "SELECT * FROM gozz.whatsapp_recordatorios WHERE enviado_at IS NULL AND programado_para <= NOW() ORDER BY programado_para ASC LIMIT 50"
  );
}

export async function marcarRecordatorioEnviado(id: string): Promise<void> {
  await query("UPDATE gozz.whatsapp_recordatorios SET enviado_at = NOW(), error = NULL WHERE id = $1", [id]);
}

export async function marcarRecordatorioError(id: string, error: string): Promise<void> {
  // Terminal, no se reintenta solo — mismo criterio que estado_entrega='fallido' de los mensajes
  // de WhatsApp: se deja visible el error y un humano decide si crear uno nuevo.
  await query("UPDATE gozz.whatsapp_recordatorios SET enviado_at = NOW(), error = $2 WHERE id = $1", [id, error.slice(0, 500)]);
}

export async function getContactoParaRecordatorio(id: string): Promise<{ email: string | null; nombre_completo: string } | null> {
  const rows = await query<{ email: string | null; nombre_completo: string }>(
    "SELECT email, nombre_completo FROM gozz.contactos_cache WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}
