// ============================================================================================
// LO QUE SE EXIGE AL DAR DE ALTA UN CONTACTO — y solo al alta
//
// 🔴 VIVE APARTE DE `ContactoFullSchema` A PROPOSITO, Y ESE ES EL PUNTO ENTERO DEL MODULO.
//
// Ese esquema lo comparten `POST /api/contactos` y `PATCH /api/contactos/:id`. Endurecerlo alli
// **romperia la edicion de 3.704 contactos vivos sin fecha de nacimiento** —el 97,2 % de la
// cartera—: cualquiera que abriera una de esas fichas a cambiar un telefono se encontraria con que
// ya no puede guardar. Lo nuevo se le exige a lo nuevo; lo que ya estaba se sigue editando igual.
//
// Hoy se exigen **email y telefono**. WhatsApp sigue opcional.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 LA FECHA DE NACIMIENTO YA NO ES OBLIGATORIA — decision de Juan del 2026-08-31
// ════════════════════════════════════════════════════════════════════════════════════════════
// Lo fue entre el 19-ago y el 31-ago. Se quita porque el alta rapida desde una oportunidad
// **pedia la fecha en un formulario que no tenia el campo**: no era un aviso, era un callejon sin
// salida. Se podia haber tapado anadiendo alli el campo y dejando la exigencia; se decidio lo
// contrario, y por el dato: **3.704 de 3.811 contactos vivos (el 97,2 %) no la tienen**, asi que
// exigirla al crear paraba altas de verdad para un dato que casi nadie tiene a mano en ese
// momento. **El campo esta en las dos pantallas**, para quien lo sepa.
//
// ⚠️ OPCIONAL NO ES «NO SE COMPRUEBA», y esa es la parte facil de perder: si viene una fecha,
// tiene que valer. Sin `esFechaDeNacimientoValida` entrarian un 31 de febrero —que JavaScript no
// rechaza, desborda al 3 de marzo— y una fecha futura por un digito de mas en el anio.
//
// A los que no la tienen se les encuentra con el filtro «sin fecha de nacimiento» del listado.
// Con la fecha opcional ese filtro **gana importancia**: pasa a ser la unica forma de ir a
// buscarlos. Un aviso al guardar no vale de nada: saltaria en 97 de cada 100 fichas, y un aviso
// que sale siempre deja de leerse en una semana (§10.7).
// ============================================================================================

/**
 * El mensaje de una fecha que vino pero no vale. No nombra la columna (§4.7).
 *
 * ⚠️ NO existe un «falta la fecha de nacimiento»: desde el 2026-08-31 no falta nunca. Si vuelve a
 * hacer falta, se anade con su motivo escrito; dejar la constante viva sin nadie que la emita es
 * una trampa para quien lea el modulo dentro de seis meses.
 */
export const FECHA_NACIMIENTO_NO_VALIDA =
  "Esa fecha de nacimiento no es válida. Revísala antes de guardar.";

/**
 * ¿Vale esta fecha de nacimiento para dar de alta un contacto?
 *
 * ⚠️ Devuelve `false` para lo ausente y lo vacio. Eso **no** significa que el alta se rechace:
 * significa que no hay fecha que guardar. Quien decide es `queFaltaParaElAlta`, que solo llama
 * aqui cuando hay valor.
 *
 * Se exige `YYYY-MM-DD`, que es lo que manda `DateField`, y se comprueba que el dia **exista**: el
 * calendario de JavaScript no falla con un 31 de febrero, se desborda al 3 de marzo. Sin esta
 * comprobacion, un dia imposible entraria en la base convertido en otro dia y nadie lo sabria.
 *
 * ⚠️ Una fecha FUTURA se rechaza. No es rebuscado: al teclear el anio es facil dejarse un digito, y
 * un contacto que nace el anio que viene no canta hasta que alguien cotiza un seguro con esa edad.
 *
 * ⚠️ Se compara en UTC a proposito. El valor es una fecha sin hora y la comparacion es contra "hoy":
 * construirla en local haria que, en un huso por delante de UTC, la fecha de hoy pareciera futura
 * durante unas horas y el alta se rechazara sin motivo aparente.
 *
 * ⚠️ NO usa `edadEnAnios`: esa vive en el frontend y calcula una edad. Esto valida una entrada. Lo
 * que comparten es el criterio de leer `YYYY-MM-DD` sin convertirlo a instante, no el codigo.
 */
export function esFechaDeNacimientoValida(valor: unknown): boolean {
  const m = typeof valor === "string" ? valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return false;

  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return false;

  return d.getTime() <= Date.now();
}

/**
 * La fecha tal como hay que guardarla: el texto sin espacios, o `null` si no hay nada.
 *
 * 🔴 EXISTE PORQUE `""` NO ES `NULL` PARA POSTGRES. `ContactoFullSchema` acepta
 * `z.string().nullable().optional()`, asi que una cadena vacia **pasa el esquema** y llegaria al
 * `INSERT` como `fecha_nacimiento = ''` contra una columna `date`: error `22007` y un **500**.
 * Mientras la fecha era obligatoria ese camino estaba tapado por la validacion; al hacerla
 * opcional se destapa, y un formulario que se deja en blanco es justamente lo que manda `""`.
 *
 * ⚠️ NO valida: solo normaliza. Un valor con hora pegada —`1980-03-12T00:00:00.000Z`, que es como
 * la API serializa una columna `date`— sale de aqui intacto, y tiene que salir asi: la ficha del
 * contacto devuelve en su `PATCH` lo mismo que leyo, y Postgres lo acepta. Rechazarlo aqui
 * romperia el guardado de toda ficha que tenga fecha.
 */
export function normalizarFechaNacimiento(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  return v === "" ? null : v;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// EMAIL Y TELÉFONO — obligatorios al alta desde la tanda C3 (2026-08-20)
//
// Mismo patrón y mismo motivo que la fecha de nacimiento de arriba: se exigen **solo al crear**.
// De 3.811 contactos vivos, **670 no tienen email**; endurecer `ContactoFullSchema` dejaría sin
// poder guardar a cualquiera que abriese una de esas fichas a cambiar un teléfono.
//
// ⚠️ WhatsApp SIGUE OPCIONAL, por decisión de Juan: no todo el mundo lo usa y exigirlo obligaría a
// inventárselo, que es peor que no tenerlo.
// ────────────────────────────────────────────────────────────────────────────────────────────

export const FALTA_EMAIL = "Falta el email. Es obligatorio para dar de alta un contacto.";
export const EMAIL_NO_VALIDO = "Ese email no parece válido. Revísalo antes de guardar.";
export const FALTA_TELEFONO = "Falta el teléfono. Es obligatorio para dar de alta un contacto.";

/**
 * Un email con la forma mínima de un email.
 *
 * No se valida contra un patrón exhaustivo: los que existen dan falsos negativos con direcciones
 * legítimas, y rechazar el correo real de un cliente es peor que aceptar uno con una errata — la
 * errata se ve al primer envío que rebota, el rechazo bloquea el alta y no se puede rodear.
 * Se exige lo que no admite discusión: algo, una arroba, algo, un punto y algo.
 */
export function esEmailValido(valor: unknown): boolean {
  const v = typeof valor === "string" ? valor.trim() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Un teléfono es cualquier cosa que no esté en blanco: el formato lo normaliza la pantalla. */
export function hayTelefono(valor: unknown): boolean {
  return typeof valor === "string" && valor.trim() !== "";
}

/**
 * Lo que impide dar de alta, o `null` si no hay nada que lo impida.
 *
 * Devuelve **un solo mensaje**, el del primer campo que falla, y en el orden en que están en el
 * formulario. Devolver los tres a la vez suena a formulario roto; de uno en uno se corrigen igual
 * de rápido y se lee mejor.
 *
 * 🔴 **La fecha de nacimiento no se exige: se comprueba SI VIENE.** Sin fecha se da de alta igual
 * (2026-08-31). Con una fecha imposible o futura, no: eso no es un dato que falte, es un dato mal
 * escrito, y guardarlo callando es como se llega a un contacto que nace el año que viene.
 *
 * Los mensajes no nombran ninguna columna (§4.7): dicen qué pasa, no cómo se llama por dentro.
 */
export function queFaltaParaElAlta(d: { fecha_nacimiento?: unknown; email?: unknown; telefono?: unknown }): string | null {
  const fecha = normalizarFechaNacimiento(d.fecha_nacimiento);
  if (fecha !== null && !esFechaDeNacimientoValida(fecha)) return FECHA_NACIMIENTO_NO_VALIDA;
  const email = typeof d.email === "string" ? d.email.trim() : "";
  if (!email) return FALTA_EMAIL;
  if (!esEmailValido(email)) return EMAIL_NO_VALIDO;
  if (!hayTelefono(d.telefono)) return FALTA_TELEFONO;
  return null;
}
