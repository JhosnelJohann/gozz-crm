import { parsePhoneNumberFromString } from "libphonenumber-js";

export interface NumeroFormateado {
  /** Lo que hay que mostrar: el número formateado, o un texto claro cuando no hay número real. */
  texto: string;
  /** Emoji de bandera del país, o null si no se pudo determinar (o no hay número real). */
  bandera: string | null;
}

/** Emoji de bandera a partir de un código ISO de 2 letras — fórmula estándar de indicadores
 * regionales Unicode, no hace falta ninguna librería para esto. */
function banderaDesdeISO(iso2?: string): string | null {
  if (!iso2 || iso2.length !== 2) return null;
  const puntos = [...iso2.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...puntos);
}

/**
 * Formatea un número de WhatsApp con bandera del país — o dice claramente que no hay número real
 * cuando no lo hay.
 *
 * Acepta un JID completo (`584121073787@s.whatsapp.net`) o solo los dígitos. Los `@lid`
 * ("Linked ID") de WhatsApp NO son números de teléfono — son un identificador opaco que WhatsApp
 * usa cuando el contacto tiene cierta privacidad activada, y no existe ninguna forma (confirmado
 * contra la propia librería de WhatsApp que usa este CRM) de recuperar el número real detrás de
 * uno. Mostrarlo como si fuera un teléfono sería mentir con más precisión, no menos — por eso este
 * caso devuelve un texto explícito en vez de un número inventado.
 */
/** Nombre a mostrar de una conversación: el de WhatsApp, o el número formateado. Nunca los dígitos
 * de un `@lid` (son un identificador interno de WhatsApp, no un teléfono). */
export function nombreVisible(c: { nombre_whatsapp: string | null; wa_jid: string; telefono_real?: string | null }): string {
  if (c.nombre_whatsapp) return c.nombre_whatsapp;
  if (c.wa_jid.endsWith("@g.us")) return "Grupo de WhatsApp";
  if (c.wa_jid.endsWith("@lid") && !c.telefono_real) return "Contacto de WhatsApp";
  return formatearNumeroWhatsApp(c.telefono_real || c.wa_jid).texto;
}

export function formatearNumeroWhatsApp(jidODigitos: string): NumeroFormateado {
  const [parte, servidor] = jidODigitos.split("@");
  if (servidor === "lid" || servidor === "g.us") {
    return { texto: "Número no disponible", bandera: null };
  }
  const digitos = parte.replace(/\D/g, "");
  if (!digitos) return { texto: jidODigitos, bandera: null };

  const parsed = parsePhoneNumberFromString(`+${digitos}`);
  if (!parsed || !parsed.isValid()) return { texto: `+${digitos}`, bandera: null };
  return { texto: parsed.formatInternational(), bandera: banderaDesdeISO(parsed.country) };
}
