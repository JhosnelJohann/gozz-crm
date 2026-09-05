-- 0001_init_gozz_schema.sql
-- Esquema base de GOZZ CRM: consolidado y limpio, sin integraciones GHL/Bitrix/Zoho/Pipedrive
-- ni tablas de backup/rescate de la migración histórica de crm-tadi. Generado a partir del
-- esquema real en producción (crm-tadi, 2026-09-03), con esas tablas/columnas eliminadas y
-- el esquema renombrado de crm_tadi -> gozz.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: gozz; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS gozz;

--
-- contactos_merge_log: bitácora de fusión de contactos (motor `lib/contactos-merge.ts`). NO es un
-- artefacto de la migración histórica de crm-tadi: es el mecanismo activo que usan `fusionar()` y
-- `revertir()` para poder deshacer cualquier fusión de contactos duplicados hecha desde la UI.
-- Sin esta tabla, la función "Fusionar contactos" queda sin bitácora y sin forma de revertir.
--

CREATE SEQUENCE IF NOT EXISTS gozz.contactos_merge_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE IF NOT EXISTS gozz.contactos_merge_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    corrida_id uuid,
    accion text,
    perdedor_id uuid,
    ganador_id uuid,
    tabla text,
    registro_id uuid,
    campo text,
    valor_antes text,
    valor_despues text,
    created_at timestamp with time zone DEFAULT now(),
    seq bigint DEFAULT nextval('gozz.contactos_merge_log_seq_seq'::regclass)
);

DO $$ BEGIN
  ALTER TABLE ONLY gozz.contactos_merge_log
    ADD CONSTRAINT contactos_merge_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_contactos_merge_log_corrida_seq ON gozz.contactos_merge_log USING btree (corrida_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_merge_log_corrida ON gozz.contactos_merge_log USING btree (corrida_id);


--
-- Name: tipo_solicitud; Type: TYPE; Schema: gozz; Owner: -
--

CREATE TYPE gozz.tipo_solicitud AS ENUM (
    'oportunidad_monto',
    'oportunidad_pago',
    'oportunidad_descuento',
    'contacto_archivar',
    'contacto_exportar',
    'oportunidad_etapa'
);


--
-- Name: contacto_solicitudes_no_regresa(); Type: FUNCTION; Schema: gozz; Owner: -
--

CREATE OR REPLACE FUNCTION gozz.contacto_solicitudes_no_regresa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.estado IN ('rechazada','ejecutada') AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    RAISE EXCEPTION
      'la solicitud % ya está en estado terminal "%": no se puede pasar a "%" (una solicitud ejecutada o rechazada no se reabre)',
      OLD.id, OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION contacto_solicitudes_no_regresa(); Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON FUNCTION gozz.contacto_solicitudes_no_regresa() IS 'OBSOLETA desde la 0066. Sustituida por gozz.solicitud_no_regresa(), compartida por las cuatro tablas de solicitudes. No se borra (§0); no se use en triggers nuevos.';


--
-- Name: prevent_super_admin_delete(); Type: FUNCTION; Schema: gozz; Owner: -
--

CREATE OR REPLACE FUNCTION gozz.prevent_super_admin_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.nivel_acceso = 'super_admin' OR OLD.inmutable = true THEN
        RAISE EXCEPTION 'Super admin cannot be deleted';
    END IF;
    RETURN OLD;
END;
$$;


--
-- Name: prevent_super_admin_demote(); Type: FUNCTION; Schema: gozz; Owner: -
--

CREATE OR REPLACE FUNCTION gozz.prevent_super_admin_demote() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.nivel_acceso = 'super_admin' AND NEW.nivel_acceso <> 'super_admin' THEN
        RAISE EXCEPTION 'Super admin level cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: solicitud_no_regresa(); Type: FUNCTION; Schema: gozz; Owner: -
--

CREATE OR REPLACE FUNCTION gozz.solicitud_no_regresa() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.estado IN ('rechazada','ejecutada') AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    RAISE EXCEPTION
      'la solicitud % ya está en estado terminal "%": no se puede pasar a "%" (una solicitud ejecutada o rechazada no se reabre)',
      OLD.id, OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION solicitud_no_regresa(); Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON FUNCTION gozz.solicitud_no_regresa() IS 'Trigger BEFORE UPDATE compartido por las cuatro tablas de solicitudes: impide reabrir una solicitud rechazada o ejecutada. Ver CONVENCIONES §10.';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: gozz; Owner: -
--

CREATE OR REPLACE FUNCTION gozz.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    nombre text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    permisos jsonb DEFAULT '{}'::jsonb,
    activo boolean DEFAULT true,
    ultimo_uso timestamp with time zone,
    total_requests integer DEFAULT 0,
    ip_whitelist jsonb DEFAULT '[]'::jsonb,
    expira_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auditoria; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    accion text NOT NULL,
    tabla_afectada text,
    registro_id text,
    datos_antes jsonb,
    datos_despues jsonb,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: buzon_acl; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.buzon_acl (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buzon_id uuid NOT NULL,
    user_id uuid,
    posicion text,
    permiso text DEFAULT 'ver'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: buzon_folder_state; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.buzon_folder_state (
    buzon_id uuid NOT NULL,
    folder text NOT NULL,
    imap_folder_name text NOT NULL,
    uid_next integer,
    ultimo_sync timestamp with time zone,
    errores_consecutivos smallint DEFAULT 0 NOT NULL,
    ultimo_error text
);


--
-- Name: buzones_email; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.buzones_email (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    imap_host text NOT NULL,
    imap_port integer DEFAULT 993 NOT NULL,
    imap_ssl boolean DEFAULT true,
    imap_user text NOT NULL,
    imap_password_enc text,
    smtp_host text NOT NULL,
    smtp_port integer DEFAULT 465 NOT NULL,
    smtp_ssl boolean DEFAULT true,
    smtp_user text,
    smtp_password_enc text,
    activo boolean DEFAULT true,
    ultimo_sync timestamp with time zone,
    sync_uid_next integer,
    import_desde_dias integer DEFAULT 7,
    errores_consecutivos integer DEFAULT 0,
    ultimo_error text,
    created_at timestamp with time zone DEFAULT now(),
    proximo_reintento_at timestamp with time zone,
    requiere_auth_update boolean DEFAULT false,
    auth_type text DEFAULT 'password'::text NOT NULL,
    oauth_provider text,
    oauth_refresh_token_enc text,
    oauth_access_token_enc text,
    oauth_token_expires_at timestamp with time zone
);


--
-- Name: cargos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.cargos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo text NOT NULL,
    nombre text NOT NULL,
    departamento_id uuid,
    valor_punto_usd numeric(10,2) DEFAULT 0,
    permisos_default jsonb DEFAULT '{}'::jsonb,
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: chat_grupos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.chat_grupos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    tipo text DEFAULT 'grupo'::text NOT NULL,
    avatar_url text,
    descripcion text,
    creado_por uuid,
    miembros jsonb DEFAULT '[]'::jsonb,
    admins jsonb DEFAULT '[]'::jsonb,
    ultimo_mensaje text,
    ultimo_mensaje_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    tarea_id uuid,
    color text,
    mensaje_fijado_id uuid,
    mensajes_fijados jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chat_grupos_tipo_check CHECK ((tipo = ANY (ARRAY['grupo'::text, 'directo'::text, 'canal'::text, 'departamento'::text, 'tarea'::text, 'copilot'::text])))
);


--
-- Name: chat_grupos_user_estado; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.chat_grupos_user_estado (
    grupo_id uuid NOT NULL,
    user_id uuid NOT NULL,
    fijado boolean DEFAULT false NOT NULL,
    oculto boolean DEFAULT false NOT NULL,
    recordar_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    silenciado boolean DEFAULT false NOT NULL
);


--
-- Name: chat_mensajes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.chat_mensajes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grupo_id uuid NOT NULL,
    user_id uuid,
    tipo text DEFAULT 'texto'::text NOT NULL,
    contenido text,
    archivo_url text,
    archivo_nombre text,
    archivo_tipo text,
    archivo_tamanio integer,
    reply_to_id uuid,
    reacciones jsonb DEFAULT '[]'::jsonb,
    leido_por jsonb DEFAULT '[]'::jsonb,
    editado boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    entregado_por jsonb DEFAULT '[]'::jsonb,
    link_preview jsonb,
    eliminado boolean DEFAULT false,
    reenviado_de text,
    menciones jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT chat_mensajes_tipo_check CHECK ((tipo = ANY (ARRAY['texto'::text, 'imagen'::text, 'archivo'::text, 'audio'::text, 'video'::text, 'sistema'::text])))
);


--
-- Name: clock_breaks; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.clock_breaks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clock_entry_id uuid NOT NULL,
    inicio_at timestamp with time zone NOT NULL,
    fin_at timestamp with time zone,
    minutos integer,
    excedido boolean DEFAULT false,
    alertado boolean DEFAULT false
);


--
-- Name: clock_entries; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.clock_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entrada_at timestamp with time zone NOT NULL,
    salida_at timestamp with time zone,
    fue_tarde boolean,
    minutos_tarde integer DEFAULT 0,
    minutos_totales integer,
    minutos_break integer DEFAULT 0,
    fecha_local date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contacto_solicitudes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.contacto_solicitudes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo gozz.tipo_solicitud NOT NULL,
    solicitante_id uuid NOT NULL,
    seleccion jsonb NOT NULL,
    contactos_afectados integer NOT NULL,
    motivo text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    aprobador_id uuid,
    motivo_rechazo text,
    resultado jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    ejecutada_at timestamp with time zone,
    CONSTRAINT contacto_solicitudes_ejecucion_chk CHECK (((estado <> 'ejecutada'::text) OR ((ejecutada_at IS NOT NULL) AND (resultado IS NOT NULL)))),
    CONSTRAINT contacto_solicitudes_estado_chk CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'ejecutada'::text]))),
    CONSTRAINT contacto_solicitudes_rechazo_chk CHECK (((estado <> 'rechazada'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT contacto_solicitudes_resuelta_chk CHECK (((estado = 'pendiente'::text) OR ((aprobador_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT contacto_solicitudes_tipo_chk CHECK ((tipo = ANY (ARRAY['contacto_archivar'::gozz.tipo_solicitud, 'contacto_exportar'::gozz.tipo_solicitud])))
);


--
-- Name: contactos_cache; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.contactos_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre_completo text NOT NULL,
    email text,
    telefono text,
    whatsapp text,
    ssn_encrypted text,
    a_number text,
    itin text,
    pasaporte_numero text,
    pasaporte_pais text,
    pasaporte_expira date,
    estatus_migratorio text,
    fecha_elegibilidad_medicare date,
    empleador_actual text,
    direcciones jsonb DEFAULT '[]'::jsonb,
    etiquetas jsonb DEFAULT '[]'::jsonb,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    notas_internas text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    estatus_migratorio_tipo text,
    estatus_migratorio_otros text,
    ciudadano_tipo text,
    nombre text,
    apellido text,
    segundo_nombre text,
    fecha_nacimiento date,
    estado_civil text,
    genero text,
    idioma text DEFAULT 'Español'::text,
    tiene_seguro_salud boolean,
    correo_personal text,
    direccion_calle text,
    direccion_linea2 text,
    direccion_ciudad text,
    direccion_estado text,
    direccion_cp text,
    direccion_pais text DEFAULT 'USA'::text,
    recibe_correo_postal boolean DEFAULT true,
    correo_uscis text,
    usuario_uscis text,
    clave_correo_uscis_enc text,
    clave_uscis_enc text,
    tipo_cliente text DEFAULT 'lead'::text,
    referido_por_contacto_id uuid,
    saldo_referidos_usd numeric(10,2) DEFAULT 0,
    pipedrive_person_id bigint,
    pipedrive_tramites text[] DEFAULT '{}'::text[],
    pipedrive_imported_at timestamp with time zone,
    zoho_id text,
    zoho_module text,
    zoho_tramites text[] DEFAULT '{}'::text[],
    zoho_imported_at timestamp with time zone,
    bitrix_contact_id text,
    bitrix_tramites text[],
    bitrix_imported_at timestamp with time zone,
    saneamiento_revision boolean DEFAULT false,
    saneamiento_motivo text,
    saneamiento_aplicado_en timestamp with time zone,
    archivado boolean DEFAULT false,
    archivado_motivo text,
    fusionado_en_contacto_id uuid,
    revision_dedup boolean DEFAULT false,
    revision_dedup_grupo text,
    archivado_at timestamp with time zone,
    archivado_por uuid,
    responsable_user_id uuid,
    agente_seguro_id uuid,
    agente_seguro_otro text,
    CONSTRAINT contactos_cache_agente_seguro_excluyente CHECK (((agente_seguro_id IS NULL) OR (agente_seguro_otro IS NULL))),
    CONSTRAINT contactos_cache_ciudadano_tipo_check CHECK (((ciudadano_tipo = ANY (ARRAY['naturalizado'::text, 'nativo'::text])) OR (ciudadano_tipo IS NULL))),
    CONSTRAINT contactos_cache_estado_civil_check CHECK (((estado_civil = ANY (ARRAY['soltero'::text, 'casado'::text, 'divorciado'::text, 'viudo'::text, 'union_libre'::text, 'separado'::text])) OR (estado_civil IS NULL))),
    CONSTRAINT contactos_cache_estatus_migratorio_tipo_check CHECK (((estatus_migratorio_tipo = ANY (ARRAY['ciudadano'::text, 'residente'::text, 'asilo_pendiente'::text, 'permiso_trabajo'::text, 'tps'::text, 'daca'::text, 'visa_u'::text, 'visa_t'::text, 'indocumentado'::text, 'otros'::text])) OR (estatus_migratorio_tipo IS NULL))),
    CONSTRAINT contactos_cache_genero_check CHECK (((genero = ANY (ARRAY['masculino'::text, 'femenino'::text, 'otro'::text])) OR (genero IS NULL))),
    CONSTRAINT contactos_cache_tipo_cliente_check CHECK ((tipo_cliente = ANY (ARRAY['lead'::text, 'referido'::text, 'cliente'::text])))
);


--
-- Name: COLUMN contactos_cache.email; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON COLUMN gozz.contactos_cache.email IS 'El correo del contacto. UNICA fuente desde la mig. 0071: antes convivia con `correo_personal` y cada pantalla leia una.';


--
-- Name: COLUMN contactos_cache.correo_personal; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON COLUMN gozz.contactos_cache.correo_personal IS 'HISTORICA (mig. 0071). El correo del contacto vive en `email`, que es la unica fuente. Esta columna NO se lee ni se escribe desde la aplicacion; se conserva porque no se borra nada (CONVENCIONES §0) y porque en 4 contactos difiere de `email` y esa diferencia todavia no la ha resuelto una persona.';


--
-- Name: COLUMN contactos_cache.agente_seguro_id; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON COLUMN gozz.contactos_cache.agente_seguro_id IS 'Agente de seguro de salud, cuando es un usuario del CRM. Etiqueta de segmentacion, no una firma: ON DELETE SET NULL. Excluyente con agente_seguro_otro.';


--
-- Name: COLUMN contactos_cache.agente_seguro_otro; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON COLUMN gozz.contactos_cache.agente_seguro_otro IS 'Agente de seguro de salud escrito a mano, para la opcion "Otro". Excluyente con agente_seguro_id.';


--
-- Name: contactos_merge_log_seq_seq; Type: SEQUENCE; Schema: gozz; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS gozz.contactos_merge_log_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contactos_notas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.contactos_notas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contacto_id uuid NOT NULL,
    user_id uuid,
    contenido text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archivos jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: departamentos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.departamentos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    jefe_id uuid,
    color text DEFAULT '#FF8609'::text,
    created_at timestamp with time zone DEFAULT now(),
    parent_id uuid,
    pos_x integer DEFAULT 0,
    pos_y integer DEFAULT 0,
    orden integer DEFAULT 0
);


--
-- Name: drive_comparticiones; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_comparticiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    folder_id uuid,
    file_id uuid,
    compartido_con uuid NOT NULL,
    compartido_por uuid NOT NULL,
    permiso text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT drive_comparticiones_no_a_uno_mismo CHECK ((compartido_con <> compartido_por)),
    CONSTRAINT drive_comparticiones_permiso_check CHECK ((permiso = ANY (ARRAY['lector'::text, 'editor'::text]))),
    CONSTRAINT drive_comparticiones_una_cosa CHECK (((folder_id IS NOT NULL) <> (file_id IS NOT NULL)))
);


--
-- Name: drive_destacados; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_destacados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    folder_id uuid,
    file_id uuid,
    ambito text NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT drive_destacados_ambito_check CHECK ((ambito = ANY (ARRAY['compania'::text, 'personal'::text]))),
    CONSTRAINT drive_destacados_una_cosa CHECK (((folder_id IS NOT NULL) <> (file_id IS NOT NULL)))
);


--
-- Name: drive_files; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    folder_id uuid NOT NULL,
    nombre text NOT NULL,
    mime text,
    size_bytes bigint,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sha256 text,
    source text,
    source_id text,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    local_path text,
    r2_key text,
    r2_etag text,
    r2_status text DEFAULT 'pending'::text,
    ciclo text DEFAULT 'activo'::text NOT NULL,
    purgar_en timestamp with time zone,
    conservado_en timestamp with time zone,
    conservado_por uuid,
    origen_ref jsonb,
    CONSTRAINT drive_files_ciclo_check CHECK ((ciclo = ANY (ARRAY['activo'::text, 'papelera'::text, 'cuarentena'::text, 'conservado'::text])))
);


--
-- Name: drive_files_purgados; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_files_purgados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    drive_file_id uuid NOT NULL,
    sha256 text,
    r2_key text,
    nombre text,
    ciclo text,
    origen text NOT NULL,
    r2_deleted boolean DEFAULT false NOT NULL,
    disk_deleted boolean DEFAULT false NOT NULL,
    borrado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drive_folders; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    parent_id uuid,
    tipo text NOT NULL,
    owner_user_id uuid,
    oportunidad_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    contacto_id uuid,
    seccion text,
    CONSTRAINT drive_folders_tipo_check CHECK ((tipo = ANY (ARRAY['root'::text, 'company'::text, 'users_root'::text, 'user'::text, 'opportunities_root'::text, 'opportunity'::text, 'custom'::text, 'contact'::text])))
);


--
-- Name: drive_recientes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.drive_recientes (
    user_id uuid NOT NULL,
    file_id uuid NOT NULL,
    visto_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: emails; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buzon_id uuid NOT NULL,
    message_id text,
    imap_uid integer,
    thread_id text,
    direccion text NOT NULL,
    from_addr text,
    from_name text,
    to_addrs jsonb DEFAULT '[]'::jsonb,
    cc_addrs jsonb DEFAULT '[]'::jsonb,
    bcc_addrs jsonb DEFAULT '[]'::jsonb,
    subject text,
    body_html text,
    body_text text,
    adjuntos jsonb DEFAULT '[]'::jsonb,
    leido boolean DEFAULT false,
    spam boolean DEFAULT false,
    carpeta text DEFAULT 'INBOX'::text,
    contacto_id uuid,
    oportunidad_id uuid,
    fecha_email timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT emails_direccion_check CHECK ((direccion = ANY (ARRAY['entrante'::text, 'saliente'::text])))
);


--
-- Name: followup_coach_messages; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.followup_coach_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    template_id text NOT NULL,
    dia integer NOT NULL,
    funcion text NOT NULL,
    variant character(1),
    channel text NOT NULL,
    body_sent text NOT NULL,
    status text NOT NULL,
    failure_reason text,
    response_text text,
    responded_at timestamp with time zone,
    clicked_at timestamp with time zone,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT followup_coach_messages_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'replied'::text, 'clicked_link'::text])))
);


--
-- Name: followup_coach_state; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.followup_coach_state (
    user_id uuid NOT NULL,
    origin text NOT NULL,
    ad_angle text NOT NULL,
    ab_variant character(1),
    dia_inicio date DEFAULT CURRENT_DATE NOT NULL,
    arco_actual smallint DEFAULT 1 NOT NULL,
    ultimo_dia_enviado integer DEFAULT 0 NOT NULL,
    paused_until timestamp with time zone,
    exit_reason text,
    exited_at timestamp with time zone,
    dead_count smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    msgs_since_calendar smallint DEFAULT 0 NOT NULL,
    pending_calendar_reminder_at timestamp with time zone,
    last_reply_hour_et smallint,
    bypass_nataly_filter boolean DEFAULT false,
    CONSTRAINT followup_coach_state_ab_variant_check CHECK (((ab_variant IS NULL) OR (ab_variant = ANY (ARRAY['A'::bpchar, 'B'::bpchar, 'C'::bpchar, 'D'::bpchar])))),
    CONSTRAINT followup_coach_state_ad_angle_check CHECK ((ad_angle = ANY (ARRAY['pasaporte'::text, 'ingles'::text, 'familia'::text, 'libertad'::text, 'neutro'::text]))),
    CONSTRAINT followup_coach_state_exit_reason_check CHECK (((exit_reason IS NULL) OR (exit_reason = ANY (ARRAY['agendo'::text, 'compro'::text, 'stop'::text, 'dead_number'::text, 'completed_90d'::text])))),
    CONSTRAINT followup_coach_state_origin_check CHECK ((origin = ANY (ARRAY['nataly_no_agendo'::text, 'sarahy_no_venta'::text])))
);


--
-- Name: followup_coach_templates; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.followup_coach_templates (
    template_id text NOT NULL,
    dia integer NOT NULL,
    arco smallint NOT NULL,
    funcion text NOT NULL,
    variant character(1),
    channel text DEFAULT 'SMS'::text NOT NULL,
    body text NOT NULL,
    ad_angle text,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chunks jsonb,
    CONSTRAINT followup_coach_templates_ad_angle_check CHECK (((ad_angle IS NULL) OR (ad_angle = ANY (ARRAY['pasaporte'::text, 'ingles'::text, 'familia'::text, 'libertad'::text, 'neutro'::text])))),
    CONSTRAINT followup_coach_templates_arco_check CHECK ((arco = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT followup_coach_templates_channel_check CHECK ((channel = ANY (ARRAY['SMS'::text, 'WhatsApp'::text, 'Email'::text])))
);


--
-- Name: notificaciones; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.notificaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tipo text NOT NULL,
    titulo text NOT NULL,
    mensaje text,
    prioridad text DEFAULT 'normal'::text,
    accion_url text,
    leida boolean DEFAULT false,
    leida_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notificaciones_prioridad_check CHECK ((prioridad = ANY (ARRAY['baja'::text, 'normal'::text, 'alta'::text, 'critica'::text])))
);


--
-- Name: oauth_pending; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oauth_pending (
    state text NOT NULL,
    user_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval)
);


--
-- Name: oportunidad_descuento_solicitudes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidad_descuento_solicitudes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    monto numeric(12,2),
    porcentaje numeric(5,2),
    motivo text NOT NULL,
    referido_contacto_id uuid,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    solicitante_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aprobador_id uuid,
    resolved_at timestamp with time zone,
    motivo_rechazo text,
    pago_id uuid,
    monto_efectivo numeric(12,2),
    tipo gozz.tipo_solicitud DEFAULT 'oportunidad_descuento'::gozz.tipo_solicitud NOT NULL,
    resultado jsonb,
    ejecutada_at timestamp with time zone,
    CONSTRAINT descuento_sol_ejecutada_tiene_resultado CHECK (((estado <> 'ejecutada'::text) OR ((ejecutada_at IS NOT NULL) AND (resultado IS NOT NULL)))),
    CONSTRAINT descuento_sol_estado_valido CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'ejecutada'::text]))),
    CONSTRAINT descuento_sol_rechazo_tiene_motivo CHECK (((estado <> 'rechazada'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT descuento_sol_resuelta_tiene_aprobador CHECK (((estado = 'pendiente'::text) OR ((aprobador_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT descuento_sol_tipo_valido CHECK ((tipo = 'oportunidad_descuento'::gozz.tipo_solicitud)),
    CONSTRAINT oportunidades_descuentos_check CHECK (((monto IS NOT NULL) OR (porcentaje IS NOT NULL)))
);


--
-- Name: oportunidad_etapa_solicitudes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidad_etapa_solicitudes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo gozz.tipo_solicitud DEFAULT 'oportunidad_etapa'::gozz.tipo_solicitud NOT NULL,
    solicitante_id uuid NOT NULL,
    cambios jsonb NOT NULL,
    oportunidades_afectadas integer NOT NULL,
    motivo text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    aprobador_id uuid,
    motivo_rechazo text,
    resultado jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    ejecutada_at timestamp with time zone,
    CONSTRAINT etapa_sol_afectadas_positiva CHECK ((oportunidades_afectadas > 0)),
    CONSTRAINT etapa_sol_cambios_no_vacio CHECK (((jsonb_typeof(cambios) = 'object'::text) AND (cambios <> '{}'::jsonb))),
    CONSTRAINT etapa_sol_ejecutada_tiene_resultado CHECK (((estado <> 'ejecutada'::text) OR ((ejecutada_at IS NOT NULL) AND (resultado IS NOT NULL)))),
    CONSTRAINT etapa_sol_estado_valido CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'ejecutada'::text]))),
    CONSTRAINT etapa_sol_rechazo_tiene_motivo CHECK (((estado <> 'rechazada'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT etapa_sol_resuelta_tiene_aprobador CHECK (((estado = 'pendiente'::text) OR ((aprobador_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT etapa_sol_tipo_valido CHECK ((tipo = 'oportunidad_etapa'::gozz.tipo_solicitud))
);


--
-- Name: TABLE oportunidad_etapa_solicitudes; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON TABLE gozz.oportunidad_etapa_solicitudes IS 'Solicitudes de cambio MASIVO de etapa. Forma canónica de CONVENCIONES §10.2. `cambios` es el mapa {oportunidad_id: etapa_destino} — cada oportunidad puede ir a una etapa distinta.';


--
-- Name: oportunidad_monto_solicitudes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidad_monto_solicitudes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    solicitante_id uuid NOT NULL,
    monto_anterior numeric,
    monto_propuesto numeric NOT NULL,
    motivo text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    aprobador_id uuid,
    motivo_rechazo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    tipo gozz.tipo_solicitud DEFAULT 'oportunidad_monto'::gozz.tipo_solicitud NOT NULL,
    resultado jsonb,
    ejecutada_at timestamp with time zone,
    CONSTRAINT monto_sol_ejecutada_tiene_resultado CHECK (((estado <> 'ejecutada'::text) OR ((ejecutada_at IS NOT NULL) AND (resultado IS NOT NULL)))),
    CONSTRAINT monto_sol_estado_valido CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'ejecutada'::text]))),
    CONSTRAINT monto_sol_rechazo_tiene_motivo CHECK (((estado <> 'rechazada'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT monto_sol_resuelta_tiene_aprobador CHECK (((estado = 'pendiente'::text) OR ((aprobador_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT monto_sol_tipo_valido CHECK ((tipo = 'oportunidad_monto'::gozz.tipo_solicitud))
);


--
-- Name: oportunidad_pago_solicitudes; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidad_pago_solicitudes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    pago_id uuid NOT NULL,
    solicitante_id uuid NOT NULL,
    cambios_propuestos jsonb DEFAULT '{}'::jsonb NOT NULL,
    datos_antes jsonb,
    comprobante_propuesto jsonb,
    comprobante_modo text,
    motivo text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    aprobador_id uuid,
    motivo_rechazo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    tipo gozz.tipo_solicitud DEFAULT 'oportunidad_pago'::gozz.tipo_solicitud NOT NULL,
    resultado jsonb,
    ejecutada_at timestamp with time zone,
    CONSTRAINT oportunidad_pago_solicitudes_comprobante_modo_check CHECK ((comprobante_modo = ANY (ARRAY['reemplazar'::text, 'adicional'::text]))),
    CONSTRAINT pago_sol_ejecutada_tiene_resultado CHECK (((estado <> 'ejecutada'::text) OR ((ejecutada_at IS NOT NULL) AND (resultado IS NOT NULL)))),
    CONSTRAINT pago_sol_estado_valido CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text, 'ejecutada'::text]))),
    CONSTRAINT pago_sol_rechazo_tiene_motivo CHECK (((estado <> 'rechazada'::text) OR (motivo_rechazo IS NOT NULL))),
    CONSTRAINT pago_sol_resuelta_tiene_aprobador CHECK (((estado = 'pendiente'::text) OR ((aprobador_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT pago_sol_tipo_valido CHECK ((tipo = 'oportunidad_pago'::gozz.tipo_solicitud))
);


--
-- Name: oportunidad_tramites; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidad_tramites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    tipo_tramite_id uuid NOT NULL,
    es_principal boolean DEFAULT false NOT NULL,
    origen text DEFAULT 'bitrix'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: oportunidades; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contacto_id uuid,
    nombre_caso text NOT NULL,
    tipo_tramite_id uuid,
    etapa text DEFAULT 'nuevo'::text NOT NULL,
    preparador_id uuid,
    vendedor_id uuid,
    manager_preparacion_id uuid,
    manager_ventas_id uuid,
    supervisor_id uuid,
    valor_total numeric(12,2) DEFAULT 0,
    balance_pendiente numeric(12,2) DEFAULT 0,
    puntaje_preparador numeric(10,2) DEFAULT 0,
    puntaje_vendedor numeric(10,2) DEFAULT 0,
    puntaje_manager_preparacion numeric(10,2) DEFAULT 0,
    puntaje_supervisor numeric(10,2) DEFAULT 0,
    puntaje_manager_general numeric(10,2) DEFAULT 0,
    documentos jsonb DEFAULT '{}'::jsonb,
    pagos jsonb DEFAULT '[]'::jsonb,
    cuestionario_datos jsonb DEFAULT '{}'::jsonb,
    cuestionario_firmado boolean DEFAULT false,
    sla_fecha_limite timestamp with time zone,
    sla_estado text DEFAULT 'on_track'::text,
    qbo_customer_id text,
    qbo_invoice_id text,
    notas text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    fecha_completada timestamp with time zone,
    referido_por_contacto_id uuid,
    puntos_asignados boolean DEFAULT false,
    descuento_referido_usd numeric(10,2) DEFAULT 0,
    manager_general_id uuid,
    fecha_ganado date,
    bitrix_deal_id bigint,
    CONSTRAINT oportunidades_sla_estado_check CHECK ((sla_estado = ANY (ARRAY['on_track'::text, 'warning'::text, 'vencido'::text, 'completado'::text])))
);


--
-- Name: oportunidades_notas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidades_notas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    user_id uuid,
    contenido text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    archivos jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: oportunidades_pagos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.oportunidades_pagos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid NOT NULL,
    monto numeric(12,2) NOT NULL,
    metodo text NOT NULL,
    titular_tipo text DEFAULT 'cliente'::text,
    titular_nombre text,
    fecha_pago date DEFAULT CURRENT_DATE NOT NULL,
    comprobante_url text,
    firma_autorizacion_url text,
    registrado_por uuid,
    notas text,
    anulado boolean DEFAULT false,
    anulado_motivo text,
    created_at timestamp with time zone DEFAULT now(),
    comprobantes_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    documentos_adicionales jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT oportunidades_pagos_metodo_check CHECK ((metodo = ANY (ARRAY['efectivo'::text, 'tarjeta'::text, 'tarjeta_tercero'::text, 'transferencia'::text, 'zelle'::text, 'cashapp'::text, 'descuento_referido'::text, 'otro'::text]))),
    CONSTRAINT oportunidades_pagos_titular_tipo_check CHECK ((titular_tipo = ANY (ARRAY['cliente'::text, 'tercero'::text])))
);


--
-- Name: password_resets; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    intentos integer DEFAULT 0 NOT NULL,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    color text DEFAULT '#5C6670'::text NOT NULL,
    orden integer NOT NULL,
    es_terminal boolean DEFAULT false,
    es_ganado boolean DEFAULT false,
    campos_obligatorios jsonb DEFAULT '[]'::jsonb,
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: puntajes_historial; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.puntajes_historial (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid,
    user_id uuid NOT NULL,
    cargo_codigo text,
    puntos numeric(10,2) NOT NULL,
    valor_punto_usd numeric(10,2) DEFAULT 0,
    monto_usd numeric(12,2) GENERATED ALWAYS AS ((puntos * valor_punto_usd)) STORED,
    fecha timestamp with time zone DEFAULT now(),
    motivo text DEFAULT 'oportunidad_completada'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone
);


--
-- Name: recognitions; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.recognitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo text NOT NULL,
    user_id uuid NOT NULL,
    semana_inicio date NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    posted_chat_grupo_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sesiones_activas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.sesiones_activas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    refresh_token_hash text,
    dispositivo text,
    ip text,
    user_agent text,
    ultimo_ping timestamp with time zone DEFAULT now(),
    activa boolean DEFAULT true,
    expira_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sso_tokens; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.sso_tokens (
    jti uuid DEFAULT gen_random_uuid() NOT NULL,
    user_email text NOT NULL,
    target_app text NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    consumer_ip text,
    CONSTRAINT sso_tokens_target_app_check CHECK ((target_app = ANY (ARRAY['ciudadania'::text, 'academia'::text])))
);


--
-- Name: stage_automation_logs; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.stage_automation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    oportunidad_id uuid,
    stage_id uuid,
    automation_id uuid,
    estado text NOT NULL,
    resultado jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: stage_automations; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.stage_automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stage_id uuid NOT NULL,
    tipo text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    activa boolean DEFAULT true,
    orden integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tareas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_tarea integer NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    propietario_id uuid,
    responsable_id uuid,
    observadores jsonb DEFAULT '[]'::jsonb,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    prioridad text DEFAULT 'normal'::text,
    urgente boolean DEFAULT false,
    fecha_inicio timestamp with time zone,
    fecha_limite timestamp with time zone,
    fecha_completada timestamp with time zone,
    oportunidad_id uuid,
    contacto_id uuid,
    etiquetas jsonb DEFAULT '[]'::jsonb,
    subtarea_de uuid,
    creada_por_ia boolean DEFAULT false,
    audio_origen_url text,
    transcripcion_origen text,
    checklist jsonb DEFAULT '[]'::jsonb,
    archivos jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    chat_grupo_id uuid,
    plantilla_id uuid,
    mute_audio boolean DEFAULT false,
    color_prioridad text GENERATED ALWAYS AS (
CASE prioridad
    WHEN 'urgente'::text THEN '#E53935'::text
    WHEN 'alta'::text THEN '#FF8609'::text
    WHEN 'normal'::text THEN '#43A847'::text
    WHEN 'baja'::text THEN '#FFB51C'::text
    ELSE '#5C6670'::text
END) STORED,
    CONSTRAINT tareas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_progreso'::text, 'completada'::text, 'cancelada'::text]))),
    CONSTRAINT tareas_prioridad_check CHECK ((prioridad = ANY (ARRAY['baja'::text, 'normal'::text, 'alta'::text, 'urgente'::text])))
);


--
-- Name: tareas_archivos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.tareas_archivos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tarea_id uuid NOT NULL,
    filename text NOT NULL,
    mime text,
    size_bytes bigint,
    url text NOT NULL,
    uploaded_by uuid,
    onlyoffice_key text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tareas_numero_tarea_seq; Type: SEQUENCE; Schema: gozz; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS gozz.tareas_numero_tarea_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tareas_numero_tarea_seq; Type: SEQUENCE OWNED BY; Schema: gozz; Owner: -
--

ALTER SEQUENCE gozz.tareas_numero_tarea_seq OWNED BY gozz.tareas.numero_tarea;


--
-- Name: tareas_plantillas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.tareas_plantillas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    titulo_tpl text NOT NULL,
    descripcion_tpl text,
    prioridad text DEFAULT 'normal'::text,
    responsable_default_id uuid,
    observadores_default jsonb DEFAULT '[]'::jsonb,
    dias_vencimiento integer DEFAULT 0,
    horas_vencimiento integer DEFAULT 0,
    checklist_default jsonb DEFAULT '[]'::jsonb,
    creado_por uuid,
    activa boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tareas_plantillas_prioridad_check CHECK ((prioridad = ANY (ARRAY['baja'::text, 'normal'::text, 'alta'::text, 'urgente'::text])))
);


--
-- Name: tramites_config; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.tramites_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    codigo text NOT NULL,
    formulario_uscis text,
    descripcion text,
    puntaje_preparador numeric(10,2) DEFAULT 0,
    puntaje_vendedor numeric(10,2) DEFAULT 0,
    puntaje_manager_preparacion numeric(10,2) DEFAULT 0,
    puntaje_supervisor numeric(10,2) DEFAULT 0,
    puntaje_manager_general numeric(10,2) DEFAULT 0,
    valor_base numeric(10,2) DEFAULT 0,
    sla_dias integer DEFAULT 30,
    es_tramite_administrativo boolean DEFAULT false,
    campos_especificos jsonb DEFAULT '{}'::jsonb,
    documentos_requeridos jsonb DEFAULT '[]'::jsonb,
    cuestionario_json jsonb DEFAULT '[]'::jsonb,
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    color text,
    puntaje_manager_ventas numeric DEFAULT 0
);


--
-- Name: uploads_borrados; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.uploads_borrados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text,
    filename text,
    origen text,
    motivo text,
    existia boolean,
    borrado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: uploads_cuarentena; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.uploads_cuarentena (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    url_original text,
    path_actual text,
    tamano_bytes bigint,
    mime text,
    subido_en timestamp with time zone,
    cuarentena_en timestamp with time zone DEFAULT now() NOT NULL,
    purgar_en timestamp with time zone,
    estado text DEFAULT 'cuarentena'::text NOT NULL,
    conservado_en timestamp with time zone,
    conservado_por uuid,
    borrado_en timestamp with time zone,
    borrado_por uuid,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uploads_cuarentena_estado_check CHECK ((estado = ANY (ARRAY['cuarentena'::text, 'conservado'::text, 'borrado'::text])))
);


--
-- Name: uploads_r2_backup; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.uploads_r2_backup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    corrida_id text,
    local_path text NOT NULL,
    modulo text NOT NULL,
    entidad_id text,
    sha256 text,
    size_bytes bigint,
    mime text,
    r2_key text,
    r2_etag text,
    r2_status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_permisos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.user_permisos (
    user_id uuid NOT NULL,
    permiso text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_preferencias; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.user_preferencias (
    user_id uuid NOT NULL,
    sonido_notifs boolean DEFAULT true,
    email_notifs boolean DEFAULT true,
    push_notifs boolean DEFAULT true,
    notifs_tareas boolean DEFAULT true,
    notifs_chat boolean DEFAULT true,
    notifs_descuentos boolean DEFAULT true,
    notifs_asistencia boolean DEFAULT true,
    dark_mode boolean,
    locale text DEFAULT 'es'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_schedule; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.user_schedule (
    user_id uuid NOT NULL,
    hora_entrada time without time zone DEFAULT '09:00:00'::time without time zone NOT NULL,
    zona_horaria text DEFAULT 'America/New_York'::text,
    tolerancia_minutos integer DEFAULT 10,
    estricto boolean DEFAULT true,
    break_minutos_max integer DEFAULT 60,
    dias_laborales jsonb DEFAULT '[1, 2, 3, 4, 5]'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_task_favoritos; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.user_task_favoritos (
    user_id uuid NOT NULL,
    tarea_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    nombre text NOT NULL,
    nivel_acceso text NOT NULL,
    posiciones jsonb DEFAULT '[]'::jsonb,
    foto_perfil_url text,
    online boolean DEFAULT false,
    zona_horaria text DEFAULT 'America/New_York'::text,
    api_key text,
    webhook_url text,
    inmutable boolean DEFAULT false,
    activo boolean DEFAULT true,
    ultimo_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bitrix_id integer,
    telefono text,
    telefono_personal text,
    departamento text,
    fecha_ingreso date,
    cumpleanos date,
    genero text,
    bio text,
    importado_desde text,
    ultima_actividad timestamp with time zone,
    CONSTRAINT users_nivel_acceso_check CHECK ((nivel_acceso = ANY (ARRAY['super_admin'::text, 'admin'::text, 'usuario'::text])))
);


--
-- Name: usuarios_perfil; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.usuarios_perfil (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usuario_id uuid NOT NULL,
    segundo_nombre text,
    fecha_nacimiento date,
    sexo text,
    telefono_movil text,
    supervisor_id uuid,
    departamento_id uuid,
    eficiencia_porcentaje numeric(5,2) DEFAULT 0,
    total_tareas_completadas integer DEFAULT 0,
    total_tareas_tiempo integer DEFAULT 0,
    total_tareas_tarde integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cargo_id uuid
);


--
-- Name: vi_solicitudes_contactos; Type: VIEW; Schema: gozz; Owner: -
--

CREATE OR REPLACE VIEW gozz.vi_solicitudes_contactos AS
 SELECT id,
    tipo,
    NULL::uuid AS oportunidad_id,
    NULL::uuid AS pago_id,
    solicitante_id,
    jsonb_build_object('seleccion', seleccion, 'contactos_afectados', contactos_afectados, 'resultado', resultado) AS detalle,
    motivo,
    estado,
    aprobador_id,
    motivo_rechazo,
    created_at,
    resolved_at,
    ejecutada_at,
    NULL::jsonb AS datos_antes,
    NULL::jsonb AS comprobante_propuesto
   FROM gozz.contacto_solicitudes;


--
-- Name: VIEW vi_solicitudes_contactos; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON VIEW gozz.vi_solicitudes_contactos IS 'Bandeja de solicitudes del dominio Contactos. Shape canónico de 15 columnas, idéntico al de vi_solicitudes_oportunidades. NO traduce estados (CONVENCIONES §10.5).';


--
-- Name: vi_solicitudes_oportunidades; Type: VIEW; Schema: gozz; Owner: -
--

CREATE OR REPLACE VIEW gozz.vi_solicitudes_oportunidades AS
 SELECT oportunidad_monto_solicitudes.id,
    oportunidad_monto_solicitudes.tipo,
    oportunidad_monto_solicitudes.oportunidad_id,
    NULL::uuid AS pago_id,
    oportunidad_monto_solicitudes.solicitante_id,
    jsonb_build_object('monto_anterior', oportunidad_monto_solicitudes.monto_anterior, 'monto_propuesto', oportunidad_monto_solicitudes.monto_propuesto) AS detalle,
    oportunidad_monto_solicitudes.motivo,
    oportunidad_monto_solicitudes.estado,
    oportunidad_monto_solicitudes.aprobador_id,
    oportunidad_monto_solicitudes.motivo_rechazo,
    oportunidad_monto_solicitudes.created_at,
    oportunidad_monto_solicitudes.resolved_at,
    oportunidad_monto_solicitudes.ejecutada_at,
    NULL::jsonb AS datos_antes,
    NULL::jsonb AS comprobante_propuesto
   FROM gozz.oportunidad_monto_solicitudes
UNION ALL
 SELECT oportunidad_pago_solicitudes.id,
    oportunidad_pago_solicitudes.tipo,
    oportunidad_pago_solicitudes.oportunidad_id,
    oportunidad_pago_solicitudes.pago_id,
    oportunidad_pago_solicitudes.solicitante_id,
    oportunidad_pago_solicitudes.cambios_propuestos AS detalle,
    oportunidad_pago_solicitudes.motivo,
    oportunidad_pago_solicitudes.estado,
    oportunidad_pago_solicitudes.aprobador_id,
    oportunidad_pago_solicitudes.motivo_rechazo,
    oportunidad_pago_solicitudes.created_at,
    oportunidad_pago_solicitudes.resolved_at,
    oportunidad_pago_solicitudes.ejecutada_at,
    oportunidad_pago_solicitudes.datos_antes,
    oportunidad_pago_solicitudes.comprobante_propuesto
   FROM gozz.oportunidad_pago_solicitudes
UNION ALL
 SELECT oportunidad_descuento_solicitudes.id,
    oportunidad_descuento_solicitudes.tipo,
    oportunidad_descuento_solicitudes.oportunidad_id,
    NULL::uuid AS pago_id,
    oportunidad_descuento_solicitudes.solicitante_id,
    jsonb_build_object('monto', oportunidad_descuento_solicitudes.monto, 'porcentaje', oportunidad_descuento_solicitudes.porcentaje) AS detalle,
    oportunidad_descuento_solicitudes.motivo,
    oportunidad_descuento_solicitudes.estado,
    oportunidad_descuento_solicitudes.aprobador_id,
    oportunidad_descuento_solicitudes.motivo_rechazo,
    oportunidad_descuento_solicitudes.created_at,
    oportunidad_descuento_solicitudes.resolved_at,
    oportunidad_descuento_solicitudes.ejecutada_at,
    NULL::jsonb AS datos_antes,
    NULL::jsonb AS comprobante_propuesto
   FROM gozz.oportunidad_descuento_solicitudes
UNION ALL
 SELECT oportunidad_etapa_solicitudes.id,
    oportunidad_etapa_solicitudes.tipo,
    NULL::uuid AS oportunidad_id,
    NULL::uuid AS pago_id,
    oportunidad_etapa_solicitudes.solicitante_id,
    jsonb_build_object('cambios', oportunidad_etapa_solicitudes.cambios, 'oportunidades_afectadas', oportunidad_etapa_solicitudes.oportunidades_afectadas, 'resultado', oportunidad_etapa_solicitudes.resultado) AS detalle,
    oportunidad_etapa_solicitudes.motivo,
    oportunidad_etapa_solicitudes.estado,
    oportunidad_etapa_solicitudes.aprobador_id,
    oportunidad_etapa_solicitudes.motivo_rechazo,
    oportunidad_etapa_solicitudes.created_at,
    oportunidad_etapa_solicitudes.resolved_at,
    oportunidad_etapa_solicitudes.ejecutada_at,
    NULL::jsonb AS datos_antes,
    NULL::jsonb AS comprobante_propuesto
   FROM gozz.oportunidad_etapa_solicitudes;


--
-- Name: VIEW vi_solicitudes_oportunidades; Type: COMMENT; Schema: gozz; Owner: -
--

COMMENT ON VIEW gozz.vi_solicitudes_oportunidades IS 'Bandeja de solicitudes del dominio Oportunidades. Shape canónico de 15 columnas, idéntico al de vi_solicitudes_contactos. NO traduce estados (CONVENCIONES §10.5).';


--
-- Name: videollamadas; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.videollamadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sala_id text NOT NULL,
    grupo_id uuid,
    iniciada_por uuid,
    nombre_sala text NOT NULL,
    participantes jsonb DEFAULT '[]'::jsonb,
    inicio timestamp with time zone DEFAULT now(),
    fin timestamp with time zone,
    duracion_segundos integer,
    transcripcion_txt text,
    resumen_ia jsonb,
    tono_reunion text,
    tareas_detectadas jsonb DEFAULT '[]'::jsonb,
    analisis_claude jsonb,
    grabacion_url text,
    created_at timestamp with time zone DEFAULT now(),
    livekit_metadata jsonb DEFAULT '{}'::jsonb,
    max_participantes integer DEFAULT 20,
    configuracion jsonb DEFAULT '{"chat": true, "reactions": true, "raise_hand": true, "screen_share": true, "background_blur": true}'::jsonb,
    tipo text DEFAULT 'grupo'::text
);


--
-- Name: videollamadas_chat; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.videollamadas_chat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    videollamada_id uuid NOT NULL,
    user_id uuid,
    tipo text DEFAULT 'texto'::text,
    contenido text,
    archivo_url text,
    reaccion text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhook_logs; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid,
    evento text NOT NULL,
    payload jsonb,
    respuesta_status integer,
    respuesta_body text,
    exitoso boolean,
    tiempo_respuesta_ms integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: webhooks_config; Type: TABLE; Schema: gozz; Owner: -
--

CREATE TABLE IF NOT EXISTS gozz.webhooks_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    nombre text NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    eventos jsonb DEFAULT '[]'::jsonb NOT NULL,
    activo boolean DEFAULT true,
    ultimo_envio timestamp with time zone,
    total_envios integer DEFAULT 0,
    total_errores integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tareas numero_tarea; Type: DEFAULT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas ALTER COLUMN numero_tarea SET DEFAULT nextval('gozz.tareas_numero_tarea_seq'::regclass);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- Name: buzon_acl buzon_acl_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzon_acl
    ADD CONSTRAINT buzon_acl_pkey PRIMARY KEY (id);


--
-- Name: buzon_folder_state buzon_folder_state_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzon_folder_state
    ADD CONSTRAINT buzon_folder_state_pkey PRIMARY KEY (buzon_id, folder);


--
-- Name: buzones_email buzones_email_owner_user_id_email_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzones_email
    ADD CONSTRAINT buzones_email_owner_user_id_email_key UNIQUE (owner_user_id, email);


--
-- Name: buzones_email buzones_email_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzones_email
    ADD CONSTRAINT buzones_email_pkey PRIMARY KEY (id);


--
-- Name: cargos cargos_codigo_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.cargos
    ADD CONSTRAINT cargos_codigo_key UNIQUE (codigo);


--
-- Name: cargos cargos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.cargos
    ADD CONSTRAINT cargos_pkey PRIMARY KEY (id);


--
-- Name: chat_grupos chat_grupos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos
    ADD CONSTRAINT chat_grupos_pkey PRIMARY KEY (id);


--
-- Name: chat_grupos_user_estado chat_grupos_user_estado_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos_user_estado
    ADD CONSTRAINT chat_grupos_user_estado_pkey PRIMARY KEY (grupo_id, user_id);


--
-- Name: chat_mensajes chat_mensajes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_mensajes
    ADD CONSTRAINT chat_mensajes_pkey PRIMARY KEY (id);


--
-- Name: clock_breaks clock_breaks_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.clock_breaks
    ADD CONSTRAINT clock_breaks_pkey PRIMARY KEY (id);


--
-- Name: clock_entries clock_entries_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.clock_entries
    ADD CONSTRAINT clock_entries_pkey PRIMARY KEY (id);


--
-- Name: contacto_solicitudes contacto_solicitudes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contacto_solicitudes
    ADD CONSTRAINT contacto_solicitudes_pkey PRIMARY KEY (id);


--
-- Name: contactos_cache contactos_cache_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_cache
    ADD CONSTRAINT contactos_cache_pkey PRIMARY KEY (id);


--
-- Name: contactos_notas contactos_notas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_notas
    ADD CONSTRAINT contactos_notas_pkey PRIMARY KEY (id);


--
-- Name: departamentos departamentos_nombre_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.departamentos
    ADD CONSTRAINT departamentos_nombre_key UNIQUE (nombre);


--
-- Name: departamentos departamentos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.departamentos
    ADD CONSTRAINT departamentos_pkey PRIMARY KEY (id);


--
-- Name: drive_comparticiones drive_comparticiones_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_comparticiones
    ADD CONSTRAINT drive_comparticiones_pkey PRIMARY KEY (id);


--
-- Name: drive_destacados drive_destacados_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_destacados
    ADD CONSTRAINT drive_destacados_pkey PRIMARY KEY (id);


--
-- Name: drive_files drive_files_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files
    ADD CONSTRAINT drive_files_pkey PRIMARY KEY (id);


--
-- Name: drive_files_purgados drive_files_purgados_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files_purgados
    ADD CONSTRAINT drive_files_purgados_pkey PRIMARY KEY (id);


--
-- Name: drive_folders drive_folders_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_pkey PRIMARY KEY (id);


--
-- Name: drive_recientes drive_recientes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_recientes
    ADD CONSTRAINT drive_recientes_pkey PRIMARY KEY (user_id, file_id);


--
-- Name: emails emails_buzon_id_message_id_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.emails
    ADD CONSTRAINT emails_buzon_id_message_id_key UNIQUE (buzon_id, message_id);


--
-- Name: emails emails_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.emails
    ADD CONSTRAINT emails_pkey PRIMARY KEY (id);


--
-- Name: followup_coach_messages followup_coach_messages_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.followup_coach_messages
    ADD CONSTRAINT followup_coach_messages_pkey PRIMARY KEY (id);


--
-- Name: followup_coach_state followup_coach_state_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.followup_coach_state
    ADD CONSTRAINT followup_coach_state_pkey PRIMARY KEY (user_id);


--
-- Name: followup_coach_templates followup_coach_templates_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.followup_coach_templates
    ADD CONSTRAINT followup_coach_templates_pkey PRIMARY KEY (template_id);


--
-- Name: notificaciones notificaciones_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.notificaciones
    ADD CONSTRAINT notificaciones_pkey PRIMARY KEY (id);


--
-- Name: oauth_pending oauth_pending_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oauth_pending
    ADD CONSTRAINT oauth_pending_pkey PRIMARY KEY (state);


--
-- Name: oportunidad_etapa_solicitudes oportunidad_etapa_solicitudes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_etapa_solicitudes
    ADD CONSTRAINT oportunidad_etapa_solicitudes_pkey PRIMARY KEY (id);


--
-- Name: oportunidad_monto_solicitudes oportunidad_monto_solicitudes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_monto_solicitudes
    ADD CONSTRAINT oportunidad_monto_solicitudes_pkey PRIMARY KEY (id);


--
-- Name: oportunidad_pago_solicitudes oportunidad_pago_solicitudes_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_pago_solicitudes
    ADD CONSTRAINT oportunidad_pago_solicitudes_pkey PRIMARY KEY (id);


--
-- Name: oportunidad_tramites oportunidad_tramites_oportunidad_id_tipo_tramite_id_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_tramites
    ADD CONSTRAINT oportunidad_tramites_oportunidad_id_tipo_tramite_id_key UNIQUE (oportunidad_id, tipo_tramite_id);


--
-- Name: oportunidad_tramites oportunidad_tramites_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_tramites
    ADD CONSTRAINT oportunidad_tramites_pkey PRIMARY KEY (id);


--
-- Name: oportunidad_descuento_solicitudes oportunidades_descuentos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidades_descuentos_pkey PRIMARY KEY (id);


--
-- Name: oportunidades_notas oportunidades_notas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_notas
    ADD CONSTRAINT oportunidades_notas_pkey PRIMARY KEY (id);


--
-- Name: oportunidades_pagos oportunidades_pagos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_pagos
    ADD CONSTRAINT oportunidades_pagos_pkey PRIMARY KEY (id);


--
-- Name: oportunidades oportunidades_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_key_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.pipeline_stages
    ADD CONSTRAINT pipeline_stages_key_key UNIQUE (key);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: puntajes_historial puntajes_historial_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.puntajes_historial
    ADD CONSTRAINT puntajes_historial_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: recognitions recognitions_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.recognitions
    ADD CONSTRAINT recognitions_pkey PRIMARY KEY (id);


--
-- Name: recognitions recognitions_tipo_user_id_semana_inicio_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.recognitions
    ADD CONSTRAINT recognitions_tipo_user_id_semana_inicio_key UNIQUE (tipo, user_id, semana_inicio);


--
-- Name: sesiones_activas sesiones_activas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.sesiones_activas
    ADD CONSTRAINT sesiones_activas_pkey PRIMARY KEY (id);


--
-- Name: sso_tokens sso_tokens_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.sso_tokens
    ADD CONSTRAINT sso_tokens_pkey PRIMARY KEY (jti);


--
-- Name: stage_automation_logs stage_automation_logs_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automation_logs
    ADD CONSTRAINT stage_automation_logs_pkey PRIMARY KEY (id);


--
-- Name: stage_automations stage_automations_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automations
    ADD CONSTRAINT stage_automations_pkey PRIMARY KEY (id);


--
-- Name: tareas_archivos tareas_archivos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_archivos
    ADD CONSTRAINT tareas_archivos_pkey PRIMARY KEY (id);


--
-- Name: tareas tareas_numero_tarea_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_numero_tarea_key UNIQUE (numero_tarea);


--
-- Name: tareas tareas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_pkey PRIMARY KEY (id);


--
-- Name: tareas_plantillas tareas_plantillas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_plantillas
    ADD CONSTRAINT tareas_plantillas_pkey PRIMARY KEY (id);


--
-- Name: tramites_config tramites_config_codigo_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tramites_config
    ADD CONSTRAINT tramites_config_codigo_key UNIQUE (codigo);


--
-- Name: tramites_config tramites_config_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tramites_config
    ADD CONSTRAINT tramites_config_pkey PRIMARY KEY (id);


--
-- Name: uploads_borrados uploads_borrados_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.uploads_borrados
    ADD CONSTRAINT uploads_borrados_pkey PRIMARY KEY (id);


--
-- Name: uploads_cuarentena uploads_cuarentena_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.uploads_cuarentena
    ADD CONSTRAINT uploads_cuarentena_pkey PRIMARY KEY (id);


--
-- Name: uploads_r2_backup uploads_r2_backup_local_path_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.uploads_r2_backup
    ADD CONSTRAINT uploads_r2_backup_local_path_key UNIQUE (local_path);


--
-- Name: uploads_r2_backup uploads_r2_backup_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.uploads_r2_backup
    ADD CONSTRAINT uploads_r2_backup_pkey PRIMARY KEY (id);


--
-- Name: user_permisos user_permisos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_permisos
    ADD CONSTRAINT user_permisos_pkey PRIMARY KEY (user_id, permiso);


--
-- Name: user_preferencias user_preferencias_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_preferencias
    ADD CONSTRAINT user_preferencias_pkey PRIMARY KEY (user_id);


--
-- Name: user_schedule user_schedule_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_schedule
    ADD CONSTRAINT user_schedule_pkey PRIMARY KEY (user_id);


--
-- Name: user_task_favoritos user_task_favoritos_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_task_favoritos
    ADD CONSTRAINT user_task_favoritos_pkey PRIMARY KEY (user_id, tarea_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: usuarios_perfil usuarios_perfil_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_pkey PRIMARY KEY (id);


--
-- Name: usuarios_perfil usuarios_perfil_usuario_id_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_usuario_id_key UNIQUE (usuario_id);


--
-- Name: videollamadas_chat videollamadas_chat_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas_chat
    ADD CONSTRAINT videollamadas_chat_pkey PRIMARY KEY (id);


--
-- Name: videollamadas videollamadas_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas
    ADD CONSTRAINT videollamadas_pkey PRIMARY KEY (id);


--
-- Name: videollamadas videollamadas_sala_jitsi_key; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas
    ADD CONSTRAINT videollamadas_sala_jitsi_key UNIQUE (sala_id);


--
-- Name: webhook_logs webhook_logs_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.webhook_logs
    ADD CONSTRAINT webhook_logs_pkey PRIMARY KEY (id);


--
-- Name: webhooks_config webhooks_config_pkey; Type: CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.webhooks_config
    ADD CONSTRAINT webhooks_config_pkey PRIMARY KEY (id);


--
-- Name: buzon_folder_state_sync_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS buzon_folder_state_sync_idx ON gozz.buzon_folder_state USING btree (ultimo_sync);


--
-- Name: contactos_cache_bitrix_uniq; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS contactos_cache_bitrix_uniq ON gozz.contactos_cache USING btree (bitrix_contact_id) WHERE (bitrix_contact_id IS NOT NULL);


--
-- Name: contactos_pipedrive_person_unique; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS contactos_pipedrive_person_unique ON gozz.contactos_cache USING btree (pipedrive_person_id) WHERE (pipedrive_person_id IS NOT NULL);


--
-- Name: contactos_pipedrive_tramites_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS contactos_pipedrive_tramites_idx ON gozz.contactos_cache USING gin (pipedrive_tramites);


--
-- Name: contactos_zoho_id_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS contactos_zoho_id_idx ON gozz.contactos_cache USING btree (zoho_id) WHERE (zoho_id IS NOT NULL);


--
-- Name: contactos_zoho_unique; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS contactos_zoho_unique ON gozz.contactos_cache USING btree (zoho_module, zoho_id) WHERE (zoho_id IS NOT NULL);


--
-- Name: drive_comparticiones_archivo_uniq; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_comparticiones_archivo_uniq ON gozz.drive_comparticiones USING btree (file_id, compartido_con) WHERE (file_id IS NOT NULL);


--
-- Name: drive_comparticiones_carpeta_uniq; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_comparticiones_carpeta_uniq ON gozz.drive_comparticiones USING btree (folder_id, compartido_con) WHERE (folder_id IS NOT NULL);


--
-- Name: drive_comparticiones_destinatario_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_comparticiones_destinatario_idx ON gozz.drive_comparticiones USING btree (compartido_con);


--
-- Name: drive_comparticiones_folder_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_comparticiones_folder_idx ON gozz.drive_comparticiones USING btree (folder_id) WHERE (folder_id IS NOT NULL);


--
-- Name: drive_destacados_ambito_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_destacados_ambito_idx ON gozz.drive_destacados USING btree (ambito, user_id);


--
-- Name: drive_destacados_compania_uniq; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_destacados_compania_uniq ON gozz.drive_destacados USING btree (COALESCE(folder_id, file_id)) WHERE (ambito = 'compania'::text);


--
-- Name: drive_destacados_personal_uniq; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_destacados_personal_uniq ON gozz.drive_destacados USING btree (COALESCE(folder_id, file_id), user_id) WHERE (ambito = 'personal'::text);


--
-- Name: drive_files_deleted_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_files_deleted_idx ON gozz.drive_files USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: drive_files_folder_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_files_folder_idx ON gozz.drive_files USING btree (folder_id);


--
-- Name: drive_files_source_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_files_source_idx ON gozz.drive_files USING btree (source, source_id) WHERE (source IS NOT NULL);


--
-- Name: drive_files_uploader_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_files_uploader_idx ON gozz.drive_files USING btree (uploaded_by);


--
-- Name: drive_folders_deleted_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_folders_deleted_idx ON gozz.drive_folders USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: drive_folders_op_unique; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_folders_op_unique ON gozz.drive_folders USING btree (oportunidad_id) WHERE (tipo = 'opportunity'::text);


--
-- Name: drive_folders_parent_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_folders_parent_idx ON gozz.drive_folders USING btree (parent_id);


--
-- Name: drive_folders_user_unique; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS drive_folders_user_unique ON gozz.drive_folders USING btree (owner_user_id) WHERE (tipo = 'user'::text);


--
-- Name: drive_recientes_persona_fecha_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS drive_recientes_persona_fecha_idx ON gozz.drive_recientes USING btree (user_id, visto_at DESC);


--
-- Name: idx_api_keys_prefix; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON gozz.api_keys USING btree (key_prefix);


--
-- Name: idx_api_keys_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON gozz.api_keys USING btree (user_id);


--
-- Name: idx_auditoria_tabla; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_auditoria_tabla ON gozz.auditoria USING btree (tabla_afectada, registro_id);


--
-- Name: idx_auditoria_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_auditoria_user ON gozz.auditoria USING btree (user_id, created_at DESC);


--
-- Name: idx_buzon_acl_buzon; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_buzon_acl_buzon ON gozz.buzon_acl USING btree (buzon_id);


--
-- Name: idx_buzon_acl_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_buzon_acl_user ON gozz.buzon_acl USING btree (user_id);


--
-- Name: idx_buzones_email_next_retry; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_buzones_email_next_retry ON gozz.buzones_email USING btree (proximo_reintento_at) WHERE ((activo = true) AND (requiere_auth_update = false));


--
-- Name: idx_chat_grupos_miembros; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_grupos_miembros ON gozz.chat_grupos USING gin (miembros);


--
-- Name: idx_chat_grupos_tarea; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_grupos_tarea ON gozz.chat_grupos USING btree (tarea_id) WHERE (tarea_id IS NOT NULL);


--
-- Name: idx_chat_grupos_tipo; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_grupos_tipo ON gozz.chat_grupos USING btree (tipo);


--
-- Name: idx_chat_mensajes_grupo; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_mensajes_grupo ON gozz.chat_mensajes USING btree (grupo_id, created_at DESC);


--
-- Name: idx_chat_user_estado_fijado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_user_estado_fijado ON gozz.chat_grupos_user_estado USING btree (user_id) WHERE (fijado = true);


--
-- Name: idx_chat_user_estado_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_user_estado_user ON gozz.chat_grupos_user_estado USING btree (user_id);


--
-- Name: idx_clock_breaks_entry; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_clock_breaks_entry ON gozz.clock_breaks USING btree (clock_entry_id);


--
-- Name: idx_clock_fecha_local; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_clock_fecha_local ON gozz.clock_entries USING btree (fecha_local, user_id);


--
-- Name: idx_clock_user_fecha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_clock_user_fecha ON gozz.clock_entries USING btree (user_id, entrada_at DESC);


--
-- Name: idx_contacto_solicitudes_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contacto_solicitudes_estado ON gozz.contacto_solicitudes USING btree (estado);


--
-- Name: idx_contacto_solicitudes_solicitante; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contacto_solicitudes_solicitante ON gozz.contacto_solicitudes USING btree (solicitante_id);


--
-- Name: idx_contactos_archivado_at; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_archivado_at ON gozz.contactos_cache USING btree (archivado_at) WHERE ((archivado = true) AND (archivado_at IS NOT NULL));


--
-- Name: idx_contactos_email; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_email ON gozz.contactos_cache USING btree (email);


--
-- Name: idx_contactos_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_estado ON gozz.contactos_cache USING btree (direccion_estado);


--
-- Name: idx_contactos_estatus_migratorio; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_estatus_migratorio ON gozz.contactos_cache USING btree (estatus_migratorio_tipo);


--
-- Name: idx_contactos_notas_contacto; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_notas_contacto ON gozz.contactos_notas USING btree (contacto_id, created_at DESC);


--
-- Name: idx_contactos_referido_por; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_referido_por ON gozz.contactos_cache USING btree (referido_por_contacto_id);


--
-- Name: idx_contactos_tipo_cliente; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_contactos_tipo_cliente ON gozz.contactos_cache USING btree (tipo_cliente);


--
-- Name: idx_dept_parent; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_dept_parent ON gozz.departamentos USING btree (parent_id);


--
-- Name: idx_descuentos_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_descuentos_estado ON gozz.oportunidad_descuento_solicitudes USING btree (estado);


--
-- Name: idx_descuentos_oport; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_descuentos_oport ON gozz.oportunidad_descuento_solicitudes USING btree (oportunidad_id);


--
-- Name: idx_descuentos_referido; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_descuentos_referido ON gozz.oportunidad_descuento_solicitudes USING btree (referido_contacto_id);


--
-- Name: idx_descuentos_solicitado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_descuentos_solicitado ON gozz.oportunidad_descuento_solicitudes USING btree (solicitante_id);


--
-- Name: idx_drive_files_ciclo_purgar; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_ciclo_purgar ON gozz.drive_files USING btree (ciclo, purgar_en) WHERE (ciclo = 'cuarentena'::text);


--
-- Name: idx_drive_files_folder_created; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_folder_created ON gozz.drive_files USING btree (folder_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_drive_files_folder_nombre; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_folder_nombre ON gozz.drive_files USING btree (folder_id, lower(nombre)) WHERE (deleted_at IS NULL);


--
-- Name: idx_drive_files_nombre_trgm; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_nombre_trgm ON gozz.drive_files USING gin (lower(nombre) public.gin_trgm_ops);


--
-- Name: idx_drive_files_papelera_deleted; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_papelera_deleted ON gozz.drive_files USING btree (deleted_at DESC) WHERE (ciclo = 'papelera'::text);


--
-- Name: idx_drive_files_purgados_created; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_purgados_created ON gozz.drive_files_purgados USING btree (created_at);


--
-- Name: idx_drive_files_purgados_sha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_purgados_sha ON gozz.drive_files_purgados USING btree (sha256);


--
-- Name: idx_drive_files_r2_status; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_r2_status ON gozz.drive_files USING btree (r2_status);


--
-- Name: idx_drive_files_sha256; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_files_sha256 ON gozz.drive_files USING btree (sha256);


--
-- Name: idx_drive_folders_contacto; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_folders_contacto ON gozz.drive_folders USING btree (contacto_id);


--
-- Name: idx_drive_folders_nombre_trgm; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_folders_nombre_trgm ON gozz.drive_folders USING gin (lower(nombre) public.gin_trgm_ops);


--
-- Name: idx_drive_folders_parent_nombre; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_drive_folders_parent_nombre ON gozz.drive_folders USING btree (parent_id, nombre) WHERE (deleted_at IS NULL);


--
-- Name: idx_emails_buzon_fecha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_emails_buzon_fecha ON gozz.emails USING btree (buzon_id, fecha_email DESC);


--
-- Name: idx_emails_carpeta; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_emails_carpeta ON gozz.emails USING btree (buzon_id, carpeta, fecha_email DESC);


--
-- Name: idx_emails_contacto; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_emails_contacto ON gozz.emails USING btree (contacto_id);


--
-- Name: idx_emails_oportunidad; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_emails_oportunidad ON gozz.emails USING btree (oportunidad_id);


--
-- Name: idx_fcm_template; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fcm_template ON gozz.followup_coach_messages USING btree (template_id, sent_at DESC);


--
-- Name: idx_fcm_user_day; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fcm_user_day ON gozz.followup_coach_messages USING btree (user_id, dia DESC);


--
-- Name: idx_fcs_active; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fcs_active ON gozz.followup_coach_state USING btree (ultimo_dia_enviado, paused_until) WHERE (exit_reason IS NULL);


--
-- Name: idx_fct_dia; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_fct_dia ON gozz.followup_coach_templates USING btree (dia, variant) WHERE active;


--
-- Name: idx_notif_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_notif_user ON gozz.notificaciones USING btree (user_id, leida);


--
-- Name: idx_oms_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oms_estado ON gozz.oportunidad_monto_solicitudes USING btree (estado);


--
-- Name: idx_oms_oportunidad; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oms_oportunidad ON gozz.oportunidad_monto_solicitudes USING btree (oportunidad_id);


--
-- Name: idx_oport_notas_oport; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oport_notas_oport ON gozz.oportunidades_notas USING btree (oportunidad_id, created_at DESC);


--
-- Name: idx_oport_pagos_fecha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oport_pagos_fecha ON gozz.oportunidades_pagos USING btree (fecha_pago);


--
-- Name: idx_oport_pagos_oport; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oport_pagos_oport ON gozz.oportunidades_pagos USING btree (oportunidad_id);


--
-- Name: idx_oportunidad_etapa_sol_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidad_etapa_sol_estado ON gozz.oportunidad_etapa_solicitudes USING btree (estado);


--
-- Name: idx_oportunidad_etapa_sol_solicitante; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidad_etapa_sol_solicitante ON gozz.oportunidad_etapa_solicitudes USING btree (solicitante_id);


--
-- Name: idx_oportunidades_etapa; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_etapa ON gozz.oportunidades USING btree (etapa);


--
-- Name: idx_oportunidades_fecha_completada; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_fecha_completada ON gozz.oportunidades USING btree (fecha_completada);


--
-- Name: idx_oportunidades_preparador; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_preparador ON gozz.oportunidades USING btree (preparador_id);


--
-- Name: idx_oportunidades_referido; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_referido ON gozz.oportunidades USING btree (referido_por_contacto_id);


--
-- Name: idx_oportunidades_sla; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oportunidades_sla ON gozz.oportunidades USING btree (sla_estado, sla_fecha_limite);


--
-- Name: idx_ops_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_estado ON gozz.oportunidad_pago_solicitudes USING btree (estado);


--
-- Name: idx_ops_oportunidad; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_oportunidad ON gozz.oportunidad_pago_solicitudes USING btree (oportunidad_id);


--
-- Name: idx_ops_pago; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_ops_pago ON gozz.oportunidad_pago_solicitudes USING btree (pago_id);


--
-- Name: idx_pipeline_stages_orden; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_orden ON gozz.pipeline_stages USING btree (orden);


--
-- Name: idx_puntajes_fecha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_puntajes_fecha ON gozz.puntajes_historial USING btree (fecha);


--
-- Name: idx_puntajes_oport; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_puntajes_oport ON gozz.puntajes_historial USING btree (oportunidad_id);


--
-- Name: idx_puntajes_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_puntajes_user ON gozz.puntajes_historial USING btree (user_id, fecha DESC);


--
-- Name: idx_push_subs_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON gozz.push_subscriptions USING btree (user_id);


--
-- Name: idx_pwreset_active; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pwreset_active ON gozz.password_resets USING btree (user_id) WHERE (used_at IS NULL);


--
-- Name: idx_pwreset_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pwreset_user ON gozz.password_resets USING btree (user_id, created_at DESC);


--
-- Name: idx_recognitions_semana; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_recognitions_semana ON gozz.recognitions USING btree (semana_inicio DESC);


--
-- Name: idx_sesiones_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sesiones_user ON gozz.sesiones_activas USING btree (user_id);


--
-- Name: idx_sesiones_user_activa; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sesiones_user_activa ON gozz.sesiones_activas USING btree (user_id, activa);


--
-- Name: idx_sso_tokens_pending; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sso_tokens_pending ON gozz.sso_tokens USING btree (jti) WHERE (consumed_at IS NULL);


--
-- Name: idx_stage_auto_logs_opp; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_stage_auto_logs_opp ON gozz.stage_automation_logs USING btree (oportunidad_id);


--
-- Name: idx_stage_automations_stage; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_stage_automations_stage ON gozz.stage_automations USING btree (stage_id);


--
-- Name: idx_tareas_archivos_tarea; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_archivos_tarea ON gozz.tareas_archivos USING btree (tarea_id);


--
-- Name: idx_tareas_chat_grupo; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_chat_grupo ON gozz.tareas USING btree (chat_grupo_id);


--
-- Name: idx_tareas_contacto; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_contacto ON gozz.tareas USING btree (contacto_id) WHERE (contacto_id IS NOT NULL);


--
-- Name: idx_tareas_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_estado ON gozz.tareas USING btree (estado);


--
-- Name: idx_tareas_fecha_limite; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_fecha_limite ON gozz.tareas USING btree (fecha_limite);


--
-- Name: idx_tareas_oportunidad; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_oportunidad ON gozz.tareas USING btree (oportunidad_id);


--
-- Name: idx_tareas_plantillas_activa; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_plantillas_activa ON gozz.tareas_plantillas USING btree (activa);


--
-- Name: idx_tareas_propietario; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_propietario ON gozz.tareas USING btree (propietario_id);


--
-- Name: idx_tareas_responsable; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_responsable ON gozz.tareas USING btree (responsable_id);


--
-- Name: idx_tareas_subtarea_de; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tareas_subtarea_de ON gozz.tareas USING btree (subtarea_de);


--
-- Name: idx_tramites_color_unico; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_tramites_color_unico ON gozz.tramites_config USING btree (color) WHERE ((activo = true) AND (color IS NOT NULL));


--
-- Name: idx_uploads_borrados_created; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_uploads_borrados_created ON gozz.uploads_borrados USING btree (created_at);


--
-- Name: idx_uploads_cuarentena_estado; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_uploads_cuarentena_estado ON gozz.uploads_cuarentena USING btree (estado, purgar_en);


--
-- Name: idx_uploads_r2_backup_corrida; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_uploads_r2_backup_corrida ON gozz.uploads_r2_backup USING btree (corrida_id);


--
-- Name: idx_uploads_r2_backup_sha; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_uploads_r2_backup_sha ON gozz.uploads_r2_backup USING btree (sha256);


--
-- Name: idx_uploads_r2_backup_status; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_uploads_r2_backup_status ON gozz.uploads_r2_backup USING btree (r2_status);


--
-- Name: idx_user_task_fav_tarea; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_task_fav_tarea ON gozz.user_task_favoritos USING btree (tarea_id);


--
-- Name: idx_user_task_fav_user; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_task_fav_user ON gozz.user_task_favoritos USING btree (user_id);


--
-- Name: idx_users_bitrix_id; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_bitrix_id ON gozz.users USING btree (bitrix_id) WHERE (bitrix_id IS NOT NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_users_email ON gozz.users USING btree (email);


--
-- Name: idx_users_nivel; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_users_nivel ON gozz.users USING btree (nivel_acceso);


--
-- Name: idx_usuarios_perfil_cargo; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_cargo ON gozz.usuarios_perfil USING btree (cargo_id);


--
-- Name: idx_usuarios_perfil_depto; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_depto ON gozz.usuarios_perfil USING btree (departamento_id);


--
-- Name: idx_usuarios_perfil_supervisor; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_supervisor ON gozz.usuarios_perfil USING btree (supervisor_id);


--
-- Name: idx_videollamadas_chat_vid; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_videollamadas_chat_vid ON gozz.videollamadas_chat USING btree (videollamada_id, created_at);


--
-- Name: idx_videollamadas_grupo; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_videollamadas_grupo ON gozz.videollamadas USING btree (grupo_id);


--
-- Name: idx_videollamadas_sala; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_videollamadas_sala ON gozz.videollamadas USING btree (sala_id);


--
-- Name: idx_webhook_logs_wh; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_webhook_logs_wh ON gozz.webhook_logs USING btree (webhook_id, created_at DESC);


--
-- Name: oauth_pending_expires_idx; Type: INDEX; Schema: gozz; Owner: -
--

CREATE INDEX IF NOT EXISTS oauth_pending_expires_idx ON gozz.oauth_pending USING btree (expires_at);


--
-- Name: uq_oportunidades_bitrix_deal; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_oportunidades_bitrix_deal ON gozz.oportunidades USING btree (bitrix_deal_id) WHERE (bitrix_deal_id IS NOT NULL);


--
-- Name: uq_uploads_cuarentena_filename; Type: INDEX; Schema: gozz; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_uploads_cuarentena_filename ON gozz.uploads_cuarentena USING btree (filename);


--
-- Name: contacto_solicitudes trg_contacto_solicitudes_no_regresa; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_contacto_solicitudes_no_regresa BEFORE UPDATE ON gozz.contacto_solicitudes FOR EACH ROW EXECUTE FUNCTION gozz.solicitud_no_regresa();


--
-- Name: oportunidad_descuento_solicitudes trg_descuento_solicitudes_no_regresa; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_descuento_solicitudes_no_regresa BEFORE UPDATE ON gozz.oportunidad_descuento_solicitudes FOR EACH ROW EXECUTE FUNCTION gozz.solicitud_no_regresa();


--
-- Name: oportunidad_monto_solicitudes trg_monto_solicitudes_no_regresa; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_monto_solicitudes_no_regresa BEFORE UPDATE ON gozz.oportunidad_monto_solicitudes FOR EACH ROW EXECUTE FUNCTION gozz.solicitud_no_regresa();


--
-- Name: oportunidad_etapa_solicitudes trg_oportunidad_etapa_sol_no_regresa; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_oportunidad_etapa_sol_no_regresa BEFORE UPDATE ON gozz.oportunidad_etapa_solicitudes FOR EACH ROW EXECUTE FUNCTION gozz.solicitud_no_regresa();


--
-- Name: oportunidad_pago_solicitudes trg_pago_solicitudes_no_regresa; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_pago_solicitudes_no_regresa BEFORE UPDATE ON gozz.oportunidad_pago_solicitudes FOR EACH ROW EXECUTE FUNCTION gozz.solicitud_no_regresa();


--
-- Name: users trg_prevent_super_admin_delete; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_prevent_super_admin_delete BEFORE DELETE ON gozz.users FOR EACH ROW EXECUTE FUNCTION gozz.prevent_super_admin_delete();


--
-- Name: users trg_prevent_super_admin_demote; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_prevent_super_admin_demote BEFORE UPDATE ON gozz.users FOR EACH ROW EXECUTE FUNCTION gozz.prevent_super_admin_demote();


--
-- Name: contactos_cache trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.contactos_cache FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: oportunidades trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.oportunidades FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: oportunidades_notas trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.oportunidades_notas FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: tareas trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.tareas FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: tareas_plantillas trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.tareas_plantillas FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: tramites_config trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.tramites_config FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: users trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.users FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: usuarios_perfil trg_updated_at; Type: TRIGGER; Schema: gozz; Owner: -
--

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON gozz.usuarios_perfil FOR EACH ROW EXECUTE FUNCTION gozz.update_updated_at();


--
-- Name: api_keys api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: auditoria auditoria_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.auditoria
    ADD CONSTRAINT auditoria_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: buzon_acl buzon_acl_buzon_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzon_acl
    ADD CONSTRAINT buzon_acl_buzon_id_fkey FOREIGN KEY (buzon_id) REFERENCES gozz.buzones_email(id) ON DELETE CASCADE;


--
-- Name: buzon_acl buzon_acl_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzon_acl
    ADD CONSTRAINT buzon_acl_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: buzon_folder_state buzon_folder_state_buzon_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzon_folder_state
    ADD CONSTRAINT buzon_folder_state_buzon_id_fkey FOREIGN KEY (buzon_id) REFERENCES gozz.buzones_email(id) ON DELETE CASCADE;


--
-- Name: buzones_email buzones_email_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.buzones_email
    ADD CONSTRAINT buzones_email_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: cargos cargos_departamento_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.cargos
    ADD CONSTRAINT cargos_departamento_id_fkey FOREIGN KEY (departamento_id) REFERENCES gozz.departamentos(id);


--
-- Name: chat_grupos chat_grupos_creado_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos
    ADD CONSTRAINT chat_grupos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES gozz.users(id);


--
-- Name: chat_grupos chat_grupos_tarea_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos
    ADD CONSTRAINT chat_grupos_tarea_id_fkey FOREIGN KEY (tarea_id) REFERENCES gozz.tareas(id) ON DELETE CASCADE;


--
-- Name: chat_grupos_user_estado chat_grupos_user_estado_grupo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos_user_estado
    ADD CONSTRAINT chat_grupos_user_estado_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES gozz.chat_grupos(id) ON DELETE CASCADE;


--
-- Name: chat_grupos_user_estado chat_grupos_user_estado_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_grupos_user_estado
    ADD CONSTRAINT chat_grupos_user_estado_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: chat_mensajes chat_mensajes_grupo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_mensajes
    ADD CONSTRAINT chat_mensajes_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES gozz.chat_grupos(id) ON DELETE CASCADE;


--
-- Name: chat_mensajes chat_mensajes_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_mensajes
    ADD CONSTRAINT chat_mensajes_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES gozz.chat_mensajes(id);


--
-- Name: chat_mensajes chat_mensajes_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.chat_mensajes
    ADD CONSTRAINT chat_mensajes_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: clock_breaks clock_breaks_clock_entry_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.clock_breaks
    ADD CONSTRAINT clock_breaks_clock_entry_id_fkey FOREIGN KEY (clock_entry_id) REFERENCES gozz.clock_entries(id) ON DELETE CASCADE;


--
-- Name: clock_entries clock_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.clock_entries
    ADD CONSTRAINT clock_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: contacto_solicitudes contacto_solicitudes_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contacto_solicitudes
    ADD CONSTRAINT contacto_solicitudes_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES gozz.users(id);


--
-- Name: contacto_solicitudes contacto_solicitudes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contacto_solicitudes
    ADD CONSTRAINT contacto_solicitudes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES gozz.users(id);


--
-- Name: contactos_cache contactos_cache_agente_seguro_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_cache
    ADD CONSTRAINT contactos_cache_agente_seguro_id_fkey FOREIGN KEY (agente_seguro_id) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: contactos_cache contactos_cache_archivado_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_cache
    ADD CONSTRAINT contactos_cache_archivado_por_fkey FOREIGN KEY (archivado_por) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: contactos_cache contactos_cache_referido_por_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_cache
    ADD CONSTRAINT contactos_cache_referido_por_contacto_id_fkey FOREIGN KEY (referido_por_contacto_id) REFERENCES gozz.contactos_cache(id) ON DELETE SET NULL;


--
-- Name: contactos_cache contactos_cache_responsable_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_cache
    ADD CONSTRAINT contactos_cache_responsable_user_id_fkey FOREIGN KEY (responsable_user_id) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: contactos_notas contactos_notas_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.contactos_notas
    ADD CONSTRAINT contactos_notas_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES gozz.contactos_cache(id);


--
-- Name: departamentos departamentos_jefe_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.departamentos
    ADD CONSTRAINT departamentos_jefe_id_fkey FOREIGN KEY (jefe_id) REFERENCES gozz.users(id);


--
-- Name: departamentos departamentos_parent_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.departamentos
    ADD CONSTRAINT departamentos_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES gozz.departamentos(id);


--
-- Name: drive_comparticiones drive_comparticiones_compartido_con_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_comparticiones
    ADD CONSTRAINT drive_comparticiones_compartido_con_fkey FOREIGN KEY (compartido_con) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: drive_comparticiones drive_comparticiones_compartido_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_comparticiones
    ADD CONSTRAINT drive_comparticiones_compartido_por_fkey FOREIGN KEY (compartido_por) REFERENCES gozz.users(id);


--
-- Name: drive_comparticiones drive_comparticiones_file_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_comparticiones
    ADD CONSTRAINT drive_comparticiones_file_id_fkey FOREIGN KEY (file_id) REFERENCES gozz.drive_files(id) ON DELETE CASCADE;


--
-- Name: drive_comparticiones drive_comparticiones_folder_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_comparticiones
    ADD CONSTRAINT drive_comparticiones_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES gozz.drive_folders(id) ON DELETE CASCADE;


--
-- Name: drive_destacados drive_destacados_file_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_destacados
    ADD CONSTRAINT drive_destacados_file_id_fkey FOREIGN KEY (file_id) REFERENCES gozz.drive_files(id) ON DELETE CASCADE;


--
-- Name: drive_destacados drive_destacados_folder_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_destacados
    ADD CONSTRAINT drive_destacados_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES gozz.drive_folders(id) ON DELETE CASCADE;


--
-- Name: drive_destacados drive_destacados_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_destacados
    ADD CONSTRAINT drive_destacados_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: drive_files drive_files_conservado_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files
    ADD CONSTRAINT drive_files_conservado_por_fkey FOREIGN KEY (conservado_por) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: drive_files drive_files_deleted_by_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files
    ADD CONSTRAINT drive_files_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: drive_files drive_files_folder_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files
    ADD CONSTRAINT drive_files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES gozz.drive_folders(id) ON DELETE CASCADE;


--
-- Name: drive_files drive_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_files
    ADD CONSTRAINT drive_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES gozz.users(id);


--
-- Name: drive_folders drive_folders_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES gozz.contactos_cache(id);


--
-- Name: drive_folders drive_folders_created_by_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES gozz.users(id);


--
-- Name: drive_folders drive_folders_deleted_by_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: drive_folders drive_folders_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: drive_folders drive_folders_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: drive_folders drive_folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_folders
    ADD CONSTRAINT drive_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES gozz.drive_folders(id) ON DELETE CASCADE;


--
-- Name: drive_recientes drive_recientes_file_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_recientes
    ADD CONSTRAINT drive_recientes_file_id_fkey FOREIGN KEY (file_id) REFERENCES gozz.drive_files(id) ON DELETE CASCADE;


--
-- Name: drive_recientes drive_recientes_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.drive_recientes
    ADD CONSTRAINT drive_recientes_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: emails emails_buzon_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.emails
    ADD CONSTRAINT emails_buzon_id_fkey FOREIGN KEY (buzon_id) REFERENCES gozz.buzones_email(id) ON DELETE RESTRICT;


--
-- Name: emails emails_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.emails
    ADD CONSTRAINT emails_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES gozz.contactos_cache(id) ON DELETE SET NULL;


--
-- Name: emails emails_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.emails
    ADD CONSTRAINT emails_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE SET NULL;


--
-- Name: followup_coach_messages followup_coach_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.followup_coach_messages
    ADD CONSTRAINT followup_coach_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.contactos_cache(id) ON DELETE CASCADE;


--
-- Name: followup_coach_state followup_coach_state_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.followup_coach_state
    ADD CONSTRAINT followup_coach_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.contactos_cache(id) ON DELETE CASCADE;


--
-- Name: notificaciones notificaciones_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.notificaciones
    ADD CONSTRAINT notificaciones_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: oportunidad_descuento_solicitudes oportunidad_descuento_solicitudes_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidad_descuento_solicitudes_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_descuento_solicitudes oportunidad_descuento_solicitudes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidad_descuento_solicitudes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_etapa_solicitudes oportunidad_etapa_solicitudes_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_etapa_solicitudes
    ADD CONSTRAINT oportunidad_etapa_solicitudes_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_etapa_solicitudes oportunidad_etapa_solicitudes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_etapa_solicitudes
    ADD CONSTRAINT oportunidad_etapa_solicitudes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_monto_solicitudes oportunidad_monto_solicitudes_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_monto_solicitudes
    ADD CONSTRAINT oportunidad_monto_solicitudes_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_monto_solicitudes oportunidad_monto_solicitudes_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_monto_solicitudes
    ADD CONSTRAINT oportunidad_monto_solicitudes_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidad_monto_solicitudes oportunidad_monto_solicitudes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_monto_solicitudes
    ADD CONSTRAINT oportunidad_monto_solicitudes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_pago_solicitudes oportunidad_pago_solicitudes_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_pago_solicitudes
    ADD CONSTRAINT oportunidad_pago_solicitudes_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_pago_solicitudes oportunidad_pago_solicitudes_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_pago_solicitudes
    ADD CONSTRAINT oportunidad_pago_solicitudes_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidad_pago_solicitudes oportunidad_pago_solicitudes_pago_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_pago_solicitudes
    ADD CONSTRAINT oportunidad_pago_solicitudes_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES gozz.oportunidades_pagos(id) ON DELETE CASCADE;


--
-- Name: oportunidad_pago_solicitudes oportunidad_pago_solicitudes_solicitante_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_pago_solicitudes
    ADD CONSTRAINT oportunidad_pago_solicitudes_solicitante_id_fkey FOREIGN KEY (solicitante_id) REFERENCES gozz.users(id);


--
-- Name: oportunidad_tramites oportunidad_tramites_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_tramites
    ADD CONSTRAINT oportunidad_tramites_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidad_tramites oportunidad_tramites_tipo_tramite_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_tramites
    ADD CONSTRAINT oportunidad_tramites_tipo_tramite_id_fkey FOREIGN KEY (tipo_tramite_id) REFERENCES gozz.tramites_config(id);


--
-- Name: oportunidades oportunidades_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES gozz.contactos_cache(id);


--
-- Name: oportunidad_descuento_solicitudes oportunidades_descuentos_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidades_descuentos_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidad_descuento_solicitudes oportunidades_descuentos_pago_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidades_descuentos_pago_id_fkey FOREIGN KEY (pago_id) REFERENCES gozz.oportunidades_pagos(id) ON DELETE SET NULL;


--
-- Name: oportunidad_descuento_solicitudes oportunidades_descuentos_referido_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidad_descuento_solicitudes
    ADD CONSTRAINT oportunidades_descuentos_referido_contacto_id_fkey FOREIGN KEY (referido_contacto_id) REFERENCES gozz.contactos_cache(id) ON DELETE SET NULL;


--
-- Name: oportunidades oportunidades_manager_preparacion_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_manager_preparacion_id_fkey FOREIGN KEY (manager_preparacion_id) REFERENCES gozz.users(id);


--
-- Name: oportunidades oportunidades_manager_ventas_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_manager_ventas_id_fkey FOREIGN KEY (manager_ventas_id) REFERENCES gozz.users(id);


--
-- Name: oportunidades_notas oportunidades_notas_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_notas
    ADD CONSTRAINT oportunidades_notas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidades_notas oportunidades_notas_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_notas
    ADD CONSTRAINT oportunidades_notas_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id);


--
-- Name: oportunidades_pagos oportunidades_pagos_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_pagos
    ADD CONSTRAINT oportunidades_pagos_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: oportunidades_pagos oportunidades_pagos_registrado_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades_pagos
    ADD CONSTRAINT oportunidades_pagos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES gozz.users(id);


--
-- Name: oportunidades oportunidades_preparador_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_preparador_id_fkey FOREIGN KEY (preparador_id) REFERENCES gozz.users(id);


--
-- Name: oportunidades oportunidades_referido_por_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_referido_por_contacto_id_fkey FOREIGN KEY (referido_por_contacto_id) REFERENCES gozz.contactos_cache(id);


--
-- Name: oportunidades oportunidades_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES gozz.users(id);


--
-- Name: oportunidades oportunidades_tipo_tramite_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_tipo_tramite_id_fkey FOREIGN KEY (tipo_tramite_id) REFERENCES gozz.tramites_config(id);


--
-- Name: oportunidades oportunidades_vendedor_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.oportunidades
    ADD CONSTRAINT oportunidades_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES gozz.users(id);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: puntajes_historial puntajes_historial_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.puntajes_historial
    ADD CONSTRAINT puntajes_historial_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: puntajes_historial puntajes_historial_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.puntajes_historial
    ADD CONSTRAINT puntajes_historial_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: recognitions recognitions_posted_chat_grupo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.recognitions
    ADD CONSTRAINT recognitions_posted_chat_grupo_id_fkey FOREIGN KEY (posted_chat_grupo_id) REFERENCES gozz.chat_grupos(id) ON DELETE SET NULL;


--
-- Name: recognitions recognitions_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.recognitions
    ADD CONSTRAINT recognitions_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: sesiones_activas sesiones_activas_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.sesiones_activas
    ADD CONSTRAINT sesiones_activas_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: stage_automation_logs stage_automation_logs_automation_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automation_logs
    ADD CONSTRAINT stage_automation_logs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES gozz.stage_automations(id);


--
-- Name: stage_automation_logs stage_automation_logs_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automation_logs
    ADD CONSTRAINT stage_automation_logs_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;


--
-- Name: stage_automation_logs stage_automation_logs_stage_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automation_logs
    ADD CONSTRAINT stage_automation_logs_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES gozz.pipeline_stages(id);


--
-- Name: stage_automations stage_automations_stage_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.stage_automations
    ADD CONSTRAINT stage_automations_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES gozz.pipeline_stages(id) ON DELETE CASCADE;


--
-- Name: tareas_archivos tareas_archivos_tarea_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_archivos
    ADD CONSTRAINT tareas_archivos_tarea_id_fkey FOREIGN KEY (tarea_id) REFERENCES gozz.tareas(id) ON DELETE CASCADE;


--
-- Name: tareas_archivos tareas_archivos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_archivos
    ADD CONSTRAINT tareas_archivos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_chat_grupo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_chat_grupo_id_fkey FOREIGN KEY (chat_grupo_id) REFERENCES gozz.chat_grupos(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_contacto_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_contacto_id_fkey FOREIGN KEY (contacto_id) REFERENCES gozz.contactos_cache(id);


--
-- Name: tareas tareas_oportunidad_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_oportunidad_id_fkey FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id);


--
-- Name: tareas tareas_plantilla_fk; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_plantilla_fk FOREIGN KEY (plantilla_id) REFERENCES gozz.tareas_plantillas(id) ON DELETE SET NULL;


--
-- Name: tareas_plantillas tareas_plantillas_creado_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_plantillas
    ADD CONSTRAINT tareas_plantillas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: tareas_plantillas tareas_plantillas_responsable_default_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas_plantillas
    ADD CONSTRAINT tareas_plantillas_responsable_default_id_fkey FOREIGN KEY (responsable_default_id) REFERENCES gozz.users(id) ON DELETE SET NULL;


--
-- Name: tareas tareas_propietario_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_propietario_id_fkey FOREIGN KEY (propietario_id) REFERENCES gozz.users(id);


--
-- Name: tareas tareas_responsable_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_responsable_id_fkey FOREIGN KEY (responsable_id) REFERENCES gozz.users(id);


--
-- Name: tareas tareas_subtarea_de_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.tareas
    ADD CONSTRAINT tareas_subtarea_de_fkey FOREIGN KEY (subtarea_de) REFERENCES gozz.tareas(id);


--
-- Name: user_permisos user_permisos_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_permisos
    ADD CONSTRAINT user_permisos_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: user_preferencias user_preferencias_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_preferencias
    ADD CONSTRAINT user_preferencias_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: user_schedule user_schedule_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_schedule
    ADD CONSTRAINT user_schedule_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: user_task_favoritos user_task_favoritos_tarea_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_task_favoritos
    ADD CONSTRAINT user_task_favoritos_tarea_id_fkey FOREIGN KEY (tarea_id) REFERENCES gozz.tareas(id) ON DELETE CASCADE;


--
-- Name: user_task_favoritos user_task_favoritos_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.user_task_favoritos
    ADD CONSTRAINT user_task_favoritos_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: usuarios_perfil usuarios_perfil_cargo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_cargo_id_fkey FOREIGN KEY (cargo_id) REFERENCES gozz.cargos(id);


--
-- Name: usuarios_perfil usuarios_perfil_departamento_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_departamento_id_fkey FOREIGN KEY (departamento_id) REFERENCES gozz.departamentos(id);


--
-- Name: usuarios_perfil usuarios_perfil_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES gozz.users(id);


--
-- Name: usuarios_perfil usuarios_perfil_usuario_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.usuarios_perfil
    ADD CONSTRAINT usuarios_perfil_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- Name: videollamadas_chat videollamadas_chat_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas_chat
    ADD CONSTRAINT videollamadas_chat_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id);


--
-- Name: videollamadas_chat videollamadas_chat_videollamada_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas_chat
    ADD CONSTRAINT videollamadas_chat_videollamada_id_fkey FOREIGN KEY (videollamada_id) REFERENCES gozz.videollamadas(id) ON DELETE CASCADE;


--
-- Name: videollamadas videollamadas_grupo_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas
    ADD CONSTRAINT videollamadas_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES gozz.chat_grupos(id);


--
-- Name: videollamadas videollamadas_iniciada_por_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.videollamadas
    ADD CONSTRAINT videollamadas_iniciada_por_fkey FOREIGN KEY (iniciada_por) REFERENCES gozz.users(id);


--
-- Name: webhook_logs webhook_logs_webhook_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.webhook_logs
    ADD CONSTRAINT webhook_logs_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES gozz.webhooks_config(id) ON DELETE CASCADE;


--
-- Name: webhooks_config webhooks_config_user_id_fkey; Type: FK CONSTRAINT; Schema: gozz; Owner: -
--

ALTER TABLE ONLY gozz.webhooks_config
    ADD CONSTRAINT webhooks_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES gozz.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


