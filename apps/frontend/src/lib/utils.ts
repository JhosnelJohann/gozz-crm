import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatea un valor SOLO-fecha (columna `date`) sin conversion de zona horaria.
 * El backend serializa los `date` como "YYYY-MM-DDT00:00:00.000Z"; usar
 * `new Date(value)` los corre al dia anterior en husos detras de UTC
 * (Caracas/ET). Aqui tomamos la parte YYYY-MM-DD y la construimos como fecha
 * LOCAL, asi se muestra exactamente el dia elegido.
 */
export function fmtFechaSolo(
  value: any,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }
): string {
  if (!value) return "";
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(value);
  return d.toLocaleDateString("es", opts).replace(".", "");
}

/** Nadie ha pasado de 122 verificados; por encima de esto la fecha esta mal, no la persona. */
const EDAD_MAXIMA_HUMANA = 130;

/**
 * Anios cumplidos HOY, o `null` si no se puede afirmar.
 *
 * Hermana de `fmtFechaSolo`, y esta aqui por lo mismo: resuelve el mismo problema de huso
 * horario sobre el mismo tipo de dato. Vive en `lib/` y no dentro de la ficha del contacto
 * porque `FusionarModal` tambien ensenia `fecha_nacimiento` al comparar duplicados.
 *
 * 🔴 POR QUE NO HAY UN `new Date(value)` AQUI, igual que en `fmtFechaSolo`
 * El backend serializa las columnas `date` como "YYYY-MM-DDT00:00:00.000Z". En un huso
 * detras de UTC —Caracas, ET, que es donde esta el equipo— `new Date()` sobre eso devuelve
 * las 20:00 del DIA ANTERIOR. Al formatear eso solo pinta mal un dia; al calcular una edad
 * es peor: **el dia del cumpleanios la edad saldria un anio de menos**, porque la fecha de
 * nacimiento se habria corrido a la vispera. Es un fallo que aparece un unico dia al anio
 * por contacto, asi que no sale probando a mano — sale con un cliente delante.
 * Por eso se extrae YYYY-MM-DD con una regex y se construye la fecha LOCAL.
 *
 * 🔴 Y POR QUE NO SE RESTAN MILISEGUNDOS dividiendo entre 365,25: eso se equivoca con los
 * bisiestos en los dos sentidos cerca del cumpleanios. La edad se compara `(anio, mes, dia)`
 * contra hoy, que es como se cuenta una edad.
 *
 * Devuelve `null` —nunca `0` ni `-1` como senial— cuando no hay valor, cuando la cadena no
 * parsea, cuando el dia no existe en el calendario, cuando la fecha es futura y cuando la
 * edad se sale del rango humano. `null` significa "no lo se", y quien pinta decide que hacer
 * con ello; un `0` afirmaria que el contacto es un recien nacido. Un `0` de verdad —un bebe
 * nacido este anio, que en este CRM existe como beneficiario derivado— si es una respuesta
 * valida y se devuelve como tal.
 *
 * ⚠️ Solo acepta cadenas que empiecen por YYYY-MM-DD, que es lo que manda la API. Un objeto
 * `Date` devuelve `null` a proposito: admitirlo obligaria a la conversion que este helper
 * existe para evitar.
 */
export function edadEnAnios(value: any): number | null {
  if (!value) return null;

  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);

  // Que la fecha EXISTA. `new Date(2001, 1, 29)` no falla: se desborda al 1 de marzo. Si el
  // dia que sale no es el que entro, la cadena no era una fecha real.
  const nacimiento = new Date(anio, mes - 1, dia);
  if (
    nacimiento.getFullYear() !== anio ||
    nacimiento.getMonth() !== mes - 1 ||
    nacimiento.getDate() !== dia
  ) {
    return null;
  }

  const hoy = new Date();
  const mesHoy = hoy.getMonth() + 1;
  const diaHoy = hoy.getDate();

  // Los anios transcurridos, menos uno si el cumpleanios de este anio todavia no ha llegado.
  // El dia exacto del cumpleanios ninguna de las dos condiciones se cumple, asi que NO resta:
  // es el caso que justifica todo el cuidado con el huso de arriba.
  let edad = hoy.getFullYear() - anio;
  if (mesHoy < mes || (mesHoy === mes && diaHoy < dia)) edad--;

  // Nacido el 29 de febrero: en un anio no bisiesto esta comparacion lo hace cumplir el 1 de
  // marzo. Es una convencion, no un error, y sobre todo no salta un anio de mas.

  if (edad < 0) return null;
  if (edad > EDAD_MAXIMA_HUMANA) return null;
  return edad;
}
