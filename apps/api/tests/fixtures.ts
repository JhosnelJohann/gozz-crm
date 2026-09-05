// ============================================================================================
// FIXTURES SINTÉTICOS — jamás datos reales.
//
// Todo lo que hay aquí lo inventa la suite y vive solo en la base desechable `crm_test_fusion`.
// Ni un nombre, ni un email, ni un teléfono sale de la base de negocio.
//
// El par que se construye está pensado para que la fusión tenga algo que demostrar:
//   · los DOS contactos tienen oportunidades, tareas, NOTAS, correos y una carpeta de Drive
//     `tipo='contact'` con documentos dentro;
//   · `telefono` y `email` están LLENOS Y DISTINTOS en los dos, para poder probar el pisado;
//   · comparten `revision_dedup_grupo`, para poder probar que el grupo queda resuelto;
//   · el maestro tiene el SSN VACÍO y el perdedor lo tiene lleno, que es el caso donde el motor
//     debe conservarlo (conducta deliberada: rellenar huecos aunque el campo sea sensible).
//
// Las NOTAS son el fixture más importante de todos: ningún par de staging tiene notas, así que la
// razón de ser de la migración 0058 —que la fusión reasigne `contactos_notas`— es indemostrable
// con datos reales. Aquí sí.
// ============================================================================================

import { query } from "../src/shared/db.js";

export interface ParDuplicado {
  maestroId: string;
  perdedorId: string;
  grupo: string;
  userId: string;
}

let contador = 0;

/** Cada llamada genera valores únicos: `contactos_cache` tiene índices únicos por id de origen. */
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

/** Un usuario sintético al que colgar tareas, documentos y buzón. Se reutiliza entre casos. */
export async function usuarioDePruebas(): Promise<string> {
  const ya = await query<any>(
    `SELECT id FROM gozz.users WHERE email = 'suite@pruebas.invalid'`
  );
  if (ya.length) return ya[0].id;
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso)
     VALUES ('suite@pruebas.invalid', 'no-es-un-hash', 'Suite de pruebas', 'admin')
     RETURNING id`
  );
  return r[0].id;
}

async function buzonDePruebas(userId: string): Promise<string> {
  const ya = await query<any>(
    `SELECT id FROM gozz.buzones_email WHERE email = 'buzon@pruebas.invalid'`
  );
  if (ya.length) return ya[0].id;
  const r = await query<any>(
    `INSERT INTO gozz.buzones_email (owner_user_id, email, imap_host, imap_user, smtp_host)
     VALUES ($1, 'buzon@pruebas.invalid', 'imap.invalid', 'buzon@pruebas.invalid', 'smtp.invalid')
     RETURNING id`,
    [userId]
  );
  return r[0].id;
}

/** Cuelga del contacto la cantidad pedida de cada cosa. Devuelve los ids creados. */
async function colgarHijos(
  contactoId: string,
  userId: string,
  buzonId: string,
  n: { ops: number; tareas: number; notas: number; correos: number; documentos: number }
): Promise<void> {
  const s = sufijo();

  for (let i = 0; i < n.ops; i++) {
    await query(
      `INSERT INTO gozz.oportunidades (contacto_id, nombre_caso) VALUES ($1, $2)`,
      [contactoId, `Caso sintético ${s}-${i}`]
    );
  }
  for (let i = 0; i < n.tareas; i++) {
    await query(
      `INSERT INTO gozz.tareas (contacto_id, titulo, propietario_id) VALUES ($1, $2, $3)`,
      [contactoId, `Tarea sintética ${s}-${i}`, userId]
    );
  }
  for (let i = 0; i < n.notas; i++) {
    await query(
      `INSERT INTO gozz.contactos_notas (contacto_id, contenido) VALUES ($1, $2)`,
      [contactoId, `Nota sintética ${s}-${i}`]
    );
  }
  for (let i = 0; i < n.correos; i++) {
    await query(
      `INSERT INTO gozz.emails (buzon_id, contacto_id, direccion, fecha_email)
       VALUES ($1, $2, 'entrante', now())`,
      [buzonId, contactoId]
    );
  }
  if (n.documentos > 0) {
    const carpeta = await query<any>(
      `INSERT INTO gozz.drive_folders (nombre, tipo, contacto_id, created_by)
       VALUES ($1, 'contact', $2, $3) RETURNING id`,
      [`Expediente sintético ${s}`, contactoId, userId]
    );
    for (let i = 0; i < n.documentos; i++) {
      await query(
        `INSERT INTO gozz.drive_files (folder_id, nombre, uploaded_by)
         VALUES ($1, $2, $3)`,
        [carpeta[0].id, `documento-${s}-${i}.pdf`, userId]
      );
    }
  }
}

export interface OpcionesContacto {
  nombre: string;
  email: string | null;
  telefono: string | null;
  ssn?: string | null;
  grupo?: string | null;
  hijos: { ops: number; tareas: number; notas: number; correos: number; documentos: number };
}

export async function crearContacto(o: OpcionesContacto): Promise<string> {
  const userId = await usuarioDePruebas();
  const buzonId = await buzonDePruebas(userId);
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache
       (nombre_completo, email, telefono, ssn_encrypted,
        revision_dedup, revision_dedup_grupo)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [o.nombre, o.email, o.telefono, o.ssn ?? null, !!o.grupo, o.grupo ?? null]
  );
  const id = r[0].id as string;
  await colgarHijos(id, userId, buzonId, o.hijos);
  return id;
}

/**
 * El par canónico: dos duplicados con datos en todas las tablas hijas y valores escalares
 * distintos y llenos. Cantidades DELIBERADAMENTE asimétricas para que una suma equivocada no pase
 * por casualidad (si los dos tuvieran 2 notas, un test que contara mal daría 4 igualmente).
 */
export async function crearParDuplicado(): Promise<ParDuplicado> {
  const s = sufijo();
  const grupo = `email:duplicado-${s}@pruebas.invalid`;
  const userId = await usuarioDePruebas();

  const maestroId = await crearContacto({
    nombre: `Maestro Sintético ${s}`,
    email: `maestro-${s}@pruebas.invalid`,
    telefono: `+1000000${s.slice(-4)}`,
    ssn: null, // vacío a propósito: el perdedor sí lo tiene y el motor debe conservarlo
    grupo,
    hijos: { ops: 2, tareas: 2, notas: 3, correos: 1, documentos: 2 },
  });

  const perdedorId = await crearContacto({
    nombre: `Perdedor Sintético ${s}`,
    email: `perdedor-${s}@pruebas.invalid`,
    telefono: `+1999999${s.slice(-4)}`,
    ssn: `SSN-SINTETICO-${s}`,
    grupo,
    hijos: { ops: 1, tareas: 3, notas: 2, correos: 2, documentos: 1 },
  });

  return { maestroId, perdedorId, grupo, userId };
}

// --------------------------------------------------------------------------------------------
// Lecturas de apoyo
// --------------------------------------------------------------------------------------------

export interface Conteos {
  oportunidades: number;
  tareas: number;
  notas: number;
  correos: number;
  carpetas: number;
}

/** Lo que cuenta §3.4 del guion de staging, más las carpetas de Drive. */
export async function conteos(contactoId: string): Promise<Conteos> {
  const r = await query<any>(
    `SELECT (SELECT count(*)::int FROM gozz.oportunidades   WHERE contacto_id = $1) AS oportunidades,
            (SELECT count(*)::int FROM gozz.tareas          WHERE contacto_id = $1) AS tareas,
            (SELECT count(*)::int FROM gozz.contactos_notas WHERE contacto_id = $1) AS notas,
            (SELECT count(*)::int FROM gozz.emails          WHERE contacto_id = $1) AS correos,
            (SELECT count(*)::int FROM gozz.drive_folders   WHERE contacto_id = $1) AS carpetas`,
    [contactoId]
  );
  return r[0];
}

/**
 * Fila completa del contacto, sin `updated_at`.
 *
 * `updated_at` se excluye porque `contactos_cache` tiene el trigger `trg_updated_at`: cualquier
 * escritura la mueve, así que después de un revert NO puede coincidir con el valor previo — y
 * exigir que coincidiera sería exigir que el revert falsificara la marca de tiempo, justo lo
 * contrario de lo que queremos. Todo lo demás sí se compara campo por campo.
 */
export async function filaContacto(contactoId: string): Promise<Record<string, any>> {
  const r = await query<any>(`SELECT * FROM gozz.contactos_cache WHERE id = $1`, [contactoId]);
  const fila = { ...r[0] };
  delete fila.updated_at;
  return fila;
}

/** Pares (pk, contacto_id) de cada tabla hija: permite comparar fila a fila, no solo totales. */
export async function hijosDetallados(contactoId: string): Promise<Record<string, string[]>> {
  const de = async (tabla: string, col = "contacto_id") =>
    (await query<any>(
      `SELECT id FROM gozz.${tabla} WHERE ${col} = $1 ORDER BY id`,
      [contactoId]
    )).map((x) => x.id as string);
  return {
    oportunidades: await de("oportunidades"),
    tareas: await de("tareas"),
    contactos_notas: await de("contactos_notas"),
    emails: await de("emails"),
    drive_folders: await de("drive_folders"),
  };
}
