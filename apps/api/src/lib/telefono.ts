// Normalización de teléfonos a E.164 para cruzar conversaciones de WhatsApp con contactos.
//
// Antes se comparaban "los últimos 10 dígitos", que cruza números de países distintos con la
// misma terminación (un +58 412… y un +1 412… pueden compartirla) y vinculaba la conversación al
// contacto equivocado. Ahora la comparación es exacta en E.164: el número de WhatsApp siempre trae
// código de país; el del contacto, que en el CRM suele estar guardado sin él ("(305) 555-1234",
// "0412-1073787"), se interpreta con el país del número de WhatsApp como país por defecto.
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface TelefonoNormalizado {
  e164: string;
  pais: CountryCode | null;
}

/** Dígitos de un JID de WhatsApp (o un número con código de país) → E.164. null si no es un
 * número válido (incluye los `@lid`, que no son teléfonos). */
export function e164DesdeWhatsApp(jidODigitos: string): TelefonoNormalizado | null {
  const [parte, servidor] = jidODigitos.split("@");
  if (servidor === "lid" || servidor === "g.us") return null;
  const digitos = (parte || "").replace(/\D/g, "");
  if (digitos.length < 7) return null;
  const p = parsePhoneNumberFromString(`+${digitos}`);
  if (!p || !p.isValid()) return null;
  return { e164: p.number, pais: (p.country as CountryCode) ?? null };
}

/** Un teléfono guardado a mano en el CRM → E.164, usando `paisPorDefecto` si no trae código de
 * país. null si no se puede interpretar como un número válido. */
export function e164DesdeTextoLibre(texto: string | null | undefined, paisPorDefecto: CountryCode | null): string | null {
  if (!texto) return null;
  const limpio = texto.trim();
  if (!limpio) return null;
  const conMas = limpio.startsWith("+") || limpio.startsWith("00");
  const p = conMas
    ? parsePhoneNumberFromString(limpio.startsWith("00") ? `+${limpio.slice(2)}` : limpio)
    : parsePhoneNumberFromString(limpio, paisPorDefecto ?? undefined);
  if (p?.isValid()) return p.number;
  // Algunos se guardaron con código de país pero sin "+" ("584121073787").
  const digitos = limpio.replace(/\D/g, "");
  if (digitos.length >= 11) {
    const q = parsePhoneNumberFromString(`+${digitos}`);
    if (q?.isValid()) return q.number;
  }
  return null;
}
