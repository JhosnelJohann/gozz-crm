// ============================================================================================
// LOS TRES DATOS SENSIBLES DE UN CONTACTO — la única puerta
//
// `contactos_cache` guarda el SSN del cliente y las credenciales de su cuenta USCIS. El blindaje
// R11 los sacó de TODAS las proyecciones (`COLS_LISTA`, `COLS_DETALLE`) y los sustituyó por
// banderas `tiene_*`. Eso estuvo bien: con `SELECT *` esas columnas viajaban al navegador de
// cualquier usuario autenticado.
//
// Pero se quitó el dato y se dejó el ojo. El equipo los guarda **para poder entrar a la cuenta
// USCIS del cliente**, y desde entonces los tres son de SOLO ESCRITURA: se escriben y no hay forma
// de volver a leerlos. Hace falta una puerta — una puerta, no volver a tirar el muro.
//
// Esto es la puerta: un endpoint dedicado, **con bitácora obligatoria**. Las tres columnas siguen
// fuera de todas las demás proyecciones y no se añaden a ninguna.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 QUIÉN PASA: CUALQUIER PERSONA ACTIVA DEL CRM — decisión de Juan, 2026-08-14
// ════════════════════════════════════════════════════════════════════════════════════════════
// La primera versión exigía el permiso `ver_datos_sensibles`, así que de hecho solo pasaban admin y
// super_admin. Se abre a todo el equipo porque **es el trabajo**: quien prepara un caso necesita
// entrar a la cuenta USCIS del cliente, y una credencial que solo puede leer un administrador
// convierte cada trámite en una petición a otra persona.
//
// ⚠️ LO QUE ESO SIGNIFICA, DICHO CLARO: cualquiera con sesión abierta puede leer el SSN y las
// credenciales de **cualquier** contacto, no solo de los suyos — aquí no hay filtro por
// responsable. Es un ensanchamiento real del acceso, tomado a propósito.
//
// Y por eso lo que queda alrededor **no se toca**, que es lo que hace sostenible la decisión:
//   · las tres columnas siguen FUERA de `COLS_LISTA` y `COLS_DETALLE` — no viajan "de paso";
//   · se piden de una en una, por su endpoint, en una petición explícita;
//   · 🔴 **cada lectura queda registrada**. Al no haber ya una puerta que decida quién entra, la
//     bitácora pasa de ser la segunda línea a ser LA línea: es lo único que permite responder
//     "¿quién miró las claves de este cliente?".
//
// Si algún día hay que volver a estrechar, el sitio es esta función y nada más.
//
// ⚠️ NO SE CIFRA NADA AQUÍ. Que las columnas `_enc` estén en claro pese al sufijo es deuda
// conocida y aparte; mezclarla en esta entrega la haría imposible de auditar.
// ============================================================================================

import { query } from "../shared/db.js";
import { esUsuarioActivo } from "./permisos.js";

const SCHEMA = "gozz";

/** Las tres, y solo las tres. Mismos nombres que `COLUMNAS_SECRETAS` en `contactos-routes.ts`. */
export const CAMPOS_SENSIBLES = ["ssn_encrypted", "clave_uscis_enc", "clave_correo_uscis_enc"] as const;

export type CampoSensible = (typeof CAMPOS_SENSIBLES)[number];

export type ResultadoSensibles =
  | { ok: true; datos: Record<CampoSensible, string | null>; auditoriaId: string }
  | { ok: false; motivo: "sin_permiso" | "no_encontrado" | "sin_bitacora" };

/**
 * Entrega los tres campos de un contacto, dejando constancia de quién los leyó.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 LA BITÁCORA VA **ANTES** DE RESPONDER, Y SI FALLA NO SE ENTREGA NADA
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Es lo contrario de lo que hace la exportación de oportunidades, y a propósito. Allí el registro
 * va DESPUÉS y no lanza (`registrarExportacion`), porque la descarga **ya ocurrió**: perderla por
 * un fallo al anotarla sería absurdo.
 *
 * Aquí el orden se invierte porque el fallo posible es el otro: si se responden las claves y luego
 * falla el INSERT, **queda una credencial leída sin rastro** — exactamente la fuga sin responsable
 * que este endpoint viene a evitar. Se anota primero; si no se puede anotar, no se entrega.
 *
 * Por eso NO lleva el `.catch(() => {})` del otro sitio. Copiarlo aquí sería copiar la forma sin la
 * razón.
 *
 * ⚠️ Se registran los NOMBRES de los campos entregados, nunca sus valores. Mismo criterio que
 * `lib/buzon-propietario.ts`: la bitácora dice QUÉ pasó, no el contenido de lo que pasó — si
 * guardara las claves, sería un segundo sitio del que robarlas, y encima inmutable (§0.2).
 */
export async function leerDatosSensibles(
  contactoId: string,
  userId: string | null | undefined
): Promise<ResultadoSensibles> {
  // Pasa cualquiera del equipo que siga activo (ver la cabecera del fichero). Se sigue consultando
  // la base y no el token: es lo que impide que alguien ya dado de baja lea claves durante los
  // meses que le queden de JWT.
  if (!(await esUsuarioActivo(userId))) return { ok: false, motivo: "sin_permiso" };

  // Lista explícita, nunca `SELECT *`: es la misma regla que sacó estas columnas del resto de
  // proyecciones. Aquí salen porque es su endpoint, no porque nadie se acordara de excluirlas.
  const [fila] = await query<any>(
    `SELECT ssn_encrypted, clave_uscis_enc, clave_correo_uscis_enc
       FROM ${SCHEMA}.contactos_cache WHERE id = $1`,
    [contactoId]
  );
  if (!fila) return { ok: false, motivo: "no_encontrado" };

  const datos = Object.fromEntries(
    CAMPOS_SENSIBLES.map((c) => [c, fila[c] || null])
  ) as Record<CampoSensible, string | null>;

  // Solo los que de verdad se entregan con contenido: es lo que se ha revelado.
  const entregados = CAMPOS_SENSIBLES.filter((c) => datos[c]);

  let auditoriaId: string;
  try {
    const [audit] = await query<any>(
      `INSERT INTO ${SCHEMA}.auditoria (user_id, accion, tabla_afectada, registro_id, datos_antes, datos_despues)
       VALUES ($1, 'Consultó los datos sensibles de un contacto', 'contactos_cache', $2, NULL, $3::jsonb)
       RETURNING id`,
      [userId, contactoId, JSON.stringify({ campos: entregados })]
    );
    auditoriaId = audit.id;
  } catch (e: any) {
    // 🔴 Sin rastro no se entrega. Ver la cabecera de esta función.
    console.error("[datos-sensibles] no se pudo registrar la consulta:", e?.message || e);
    return { ok: false, motivo: "sin_bitacora" };
  }

  return { ok: true, datos, auditoriaId };
}
