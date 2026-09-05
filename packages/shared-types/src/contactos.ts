// Tipos del slice de contactos. Espejan las proyecciones EXPLÍCITAS que expone la API
// (`modules/contactos/contactos.routes.ts` → COLS_LISTA / COLS_DETALLE) — nunca las tres columnas
// secretas (`ssn_encrypted`, `clave_uscis_enc`, `clave_correo_uscis_enc`), que jamás salen por la
// red. La validación de entrada (Zod) sigue viviendo solo en el backend; esto es el contrato TS.

export type TipoCliente = "lead" | "referido" | "cliente";
export type EstadoCivil = "soltero" | "casado" | "divorciado" | "viudo" | "union_libre" | "separado";
export type Genero = "masculino" | "femenino" | "otro";
export type EstatusMigratorioTipo =
  | "ciudadano" | "residente" | "asilo_pendiente" | "permiso_trabajo" | "tps" | "daca"
  | "visa_u" | "visa_t" | "indocumentado" | "otros";
export type CiudadanoTipo = "naturalizado" | "nativo";

/** Fila tal como la devuelve el listado (`GET /api/contactos`, `GET /api/contactos/search`). */
export interface ContactoListItem {
  id: string;
  nombre_completo: string;
  email: string | null;
  telefono: string | null;
  whatsapp: string | null;
  tipo_cliente: TipoCliente | null;
  estatus_migratorio: string | null;
  estatus_migratorio_tipo: EstatusMigratorioTipo | null;
  bitrix_contact_id: string | null;
  zoho_id: string | null;
  pipedrive_person_id: number | null;
  pipedrive_tramites: string[] | null;
  zoho_tramites: string[] | null;
  revision_dedup_grupo: string | null;
  responsable_user_id: string | null;
  responsable_nombre: string | null;
  created_at: string;
}

/** Ficha completa (`GET /api/contactos/:id`). Con banderas `tiene_*` en vez de los secretos. */
export interface ContactoDetalle {
  id: string;
  nombre_completo: string;
  nombre: string | null;
  apellido: string | null;
  segundo_nombre: string | null;
  email: string | null;
  telefono: string | null;
  whatsapp: string | null;
  a_number: string | null;
  itin: string | null;
  pasaporte_numero: string | null;
  pasaporte_pais: string | null;
  pasaporte_expira: string | null;
  estatus_migratorio: string | null;
  estatus_migratorio_tipo: EstatusMigratorioTipo | null;
  estatus_migratorio_otros: string | null;
  ciudadano_tipo: CiudadanoTipo | null;
  fecha_nacimiento: string | null;
  fecha_elegibilidad_medicare: string | null;
  estado_civil: EstadoCivil | null;
  genero: Genero | null;
  idioma: string | null;
  tiene_seguro_salud: boolean | null;
  empleador_actual: string | null;
  agente_seguro_id: string | null;
  agente_seguro_otro: string | null;
  direccion_calle: string | null;
  direccion_linea2: string | null;
  direccion_ciudad: string | null;
  direccion_estado: string | null;
  direccion_cp: string | null;
  direccion_pais: string | null;
  recibe_correo_postal: boolean | null;
  direcciones: unknown;
  correo_uscis: string | null;
  usuario_uscis: string | null;
  tipo_cliente: TipoCliente | null;
  referido_por_contacto_id: string | null;
  saldo_referidos_usd: number | null;
  etiquetas: string[];
  custom_fields: unknown;
  notas_internas: string | null;
  bitrix_contact_id: string | null;
  bitrix_tramites: string[] | null;
  bitrix_imported_at: string | null;
  zoho_id: string | null;
  zoho_module: string | null;
  zoho_tramites: string[] | null;
  zoho_imported_at: string | null;
  pipedrive_person_id: number | null;
  pipedrive_tramites: string[] | null;
  pipedrive_imported_at: string | null;
  saneamiento_revision: boolean | null;
  saneamiento_motivo: string | null;
  saneamiento_aplicado_en: string | null;
  archivado: boolean | null;
  archivado_motivo: string | null;
  fusionado_en_contacto_id: string | null;
  revision_dedup: boolean | null;
  revision_dedup_grupo: string | null;
  responsable_user_id: string | null;
  created_at: string;
  updated_at: string;
  /** Presencia de cada secreto ("hay valor guardado"), nunca el valor. */
  tiene_ssn: boolean;
  tiene_clave_uscis: boolean;
  tiene_clave_correo_uscis: boolean;
}

/** Cuerpo de `POST /api/contactos` y `PATCH /api/contactos/:id` (parcial en el PATCH). */
export interface ContactoInput {
  nombre_completo?: string;
  nombre?: string | null;
  apellido?: string | null;
  segundo_nombre?: string | null;
  fecha_nacimiento?: string | null;
  estado_civil?: EstadoCivil | null;
  genero?: Genero | null;
  idioma?: string | null;
  tiene_seguro_salud?: boolean | null;
  agente_seguro_id?: string | null;
  agente_seguro_otro?: string | null;
  email?: string | null;
  telefono?: string | null;
  whatsapp?: string | null;
  estatus_migratorio?: string | null;
  estatus_migratorio_tipo?: EstatusMigratorioTipo | null;
  estatus_migratorio_otros?: string | null;
  ciudadano_tipo?: CiudadanoTipo | null;
  a_number?: string | null;
  itin?: string | null;
  pasaporte_numero?: string | null;
  pasaporte_pais?: string | null;
  /** Solo de ESCRITURA: nunca vuelve en una respuesta (ver `tiene_ssn` en `ContactoDetalle`). */
  ssn_encrypted?: string | null;
  direccion_calle?: string | null;
  direccion_linea2?: string | null;
  direccion_ciudad?: string | null;
  direccion_estado?: string | null;
  direccion_cp?: string | null;
  direccion_pais?: string | null;
  recibe_correo_postal?: boolean | null;
  correo_uscis?: string | null;
  usuario_uscis?: string | null;
  /** Solo de ESCRITURA: nunca vuelven en una respuesta (ver `tiene_clave_*` en `ContactoDetalle`). */
  clave_correo_uscis_enc?: string | null;
  clave_uscis_enc?: string | null;
  tipo_cliente?: TipoCliente | null;
  referido_por_contacto_id?: string | null;
  saldo_referidos_usd?: number | null;
  empleador_actual?: string | null;
  notas_internas?: string | null;
  etiquetas?: string[];
}
