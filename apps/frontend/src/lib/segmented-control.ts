// ============================================================================================
// LAS DECISIONES DE UN SEGMENTED CONTROL — separadas del pintado para poder probarlas
//
// El componente en sí es JSX y `apps/frontend` no tiene runner de componentes (FASE 2, aplazada a
// conciencia, §9.1). Lo que sí se puede probar —y lo que de verdad se puede romper— son las dos
// reglas de comportamiento: **cuándo se deselecciona** y **a dónde lleva cada flecha**.
//
// Las dos parecen triviales y ninguna lo es: la primera es la que impide que un contacto se quede
// con un agente puesto por error y sin forma de quitarlo, y la segunda es la que hace que el
// control se pueda usar sin ratón.
// ============================================================================================

/**
 * Qué pasa al pulsar un segmento.
 *
 * 🔴 PULSAR EL QUE YA ESTÁ SELECCIONADO LO DESELECCIONA, y ése es el punto entero de esta función.
 *
 * Un segmented control normalmente tiene siempre uno activo — y aquí eso sería un problema: si
 * alguien marca un agente por error, no tendría forma de volver atrás. Es el mismo principio que
 * `CONVENCIONES §2.8`: **todo sitio que concede algo tiene que tener cómo cambiarlo**, y "cambiarlo"
 * incluye "quitarlo".
 *
 * "Ninguno seleccionado" no es un estado degradado: es el de casi toda la cartera. Un contacto con
 * seguro al que todavía no se le ha asignado agente está exactamente ahí.
 */
export function alPulsarSegmento(seleccionado: string | null, pulsado: string): string | null {
  return seleccionado === pulsado ? null : pulsado;
}

/**
 * A qué segmento lleva una flecha del teclado.
 *
 * Da la vuelta por los dos extremos, que es lo que hace el patrón de un grupo de radios: llegar al
 * final y seguir pulsando no puede dejar al usuario atascado sin saber por qué.
 *
 * ⚠️ Si no hay nada seleccionado, la primera flecha entra por el principio (derecha/abajo) o por el
 * final (izquierda/arriba), en vez de no hacer nada. Un control que ignora la primera pulsación
 * parece roto.
 */
export function siguienteSegmento(
  seleccionado: string | null,
  valores: string[],
  direccion: 1 | -1
): string | null {
  if (valores.length === 0) return null;
  const i = seleccionado === null ? -1 : valores.indexOf(seleccionado);
  if (i < 0) return direccion === 1 ? valores[0] : valores[valores.length - 1];
  return valores[(i + direccion + valores.length) % valores.length];
}
