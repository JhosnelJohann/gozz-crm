// ============================================================================================
// DESCARGAS — el nombre del fichero lo decide el SERVIDOR
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 EL FALLO QUE ESTO CIERRA, Y POR QUÉ ERA INVISIBLE
// ════════════════════════════════════════════════════════════════════════════════════════════
// La exportación se dispara desde un blob (`URL.createObjectURL` + `<a download>`). **Con
// `a.download` puesto, el navegador usa ESE nombre e ignora por completo la cabecera
// `Content-Disposition`** que manda el servidor.
//
// El modal se inventaba el suyo con `new Date().toISOString().slice(0,10)`. Resultado: `nombreFichero`
// del backend —corregido para estampar hora y zona `America/New_York`, con sus pruebas, y ya en
// producción— **no tenía ningún efecto**. El usuario seguía recibiendo `oportunidades_2026-08-13.csv`,
// sin hora y con la fecha en UTC: exactamente el fallo que dábamos por cerrado.
//
// La lección, que es la que vale para la próxima: **dos sitios calculando el mismo nombre y el
// segundo siempre se queda atrás**. Por eso aquí no se reconstruye nada — se LEE lo que dijo el
// servidor. Es lo que ya hacen bien las descargas del Drive (`SinIdentificarPanel.tsx`), que usan
// el nombre que viene del servidor.
//
// Es una función pura y exportada a propósito: hoy `apps/frontend` no tiene runner de pruebas —
// solo `apps/api` tiene vitest— así que esto **no está cubierto por la suite**. Dejarlo separado y
// sin dependencias del DOM es lo que lo hará comprobable el día que lo haya.
// ============================================================================================

/**
 * Saca el nombre del fichero de una cabecera `Content-Disposition`.
 *
 * Entiende la forma que emite el servidor hoy —`attachment; filename="oportunidades_….csv"`— y
 * tolera las dos variantes que se ven en la práctica: **sin comillas** y **con espacios de más**.
 *
 * 🔴 SI FALTA O NO SE PUEDE PARSEAR, devuelve `<base>.<formato>` **sin fecha**. No se reconstruye
 * la fecha en el cliente: dos sitios calculando el mismo nombre es justo el fallo que esto viene a
 * arreglar. Mejor un nombre pobre y honesto que uno inventado que contradiga al fichero.
 * El servidor pone la cabecera de forma incondicional, así que el respaldo no debería usarse nunca.
 */
export function nombreDesdeCabecera(
  cd: string | null | undefined,
  formato: string,
  base = "oportunidades"
): string {
  const respaldo = `${base}.${formato}`;
  if (!cd) return respaldo;

  let nombre: string | null = null;

  // `filename*=UTF-8''…` (RFC 5987) manda sobre `filename` cuando está. Hoy el servidor no lo
  // emite —los nombres son ASCII—, pero si algún día lo hiciera, sin esto caeríamos al respaldo y
  // perderíamos la fecha **en silencio**, que es la clase de regresión que estamos cerrando.
  const extendido = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(cd);
  if (extendido) {
    try { nombre = decodeURIComponent(extendido[1].trim()); } catch { nombre = null; }
  }

  if (!nombre) {
    // Con comillas o sin ellas, y con los espacios que haga falta.
    const simple = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(cd);
    if (simple) nombre = (simple[1] ?? simple[2] ?? "").trim();
  }

  if (!nombre) return respaldo;

  // El nombre viene de nuestro propio servidor y del mismo origen, así que esto es cinturón y
  // tirantes: un separador de rutas en un `download` no debería llegar nunca, y si llega es que
  // algo va mal río arriba — mejor el respaldo que un nombre raro.
  if (/[\\/]/.test(nombre) || nombre === "." || nombre === "..") return respaldo;

  return nombre || respaldo;
}
