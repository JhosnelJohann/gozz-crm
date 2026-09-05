// ==============================================================================================
// QUÉ IMPIDE DAR DE ALTA UN CONTACTO — una sola regla para las dos pantallas
//
// El alta de un contacto se hace desde dos sitios: el modal «Nuevo contacto» del listado y el
// mini-formulario del selector de contacto de «Nueva oportunidad». Los dos llaman a la misma ruta,
// `POST /api/contactos`, así que la regla es una — pero estaba escrita dos veces, y ya había
// divergido:
//
//   · el modal exigía email Y teléfono, como el servidor;
//   · el mini-formulario pedía «teléfono O email» (`ContactoPicker.tsx:127` antes de esta entrega).
//
// Quien rellenaba solo el teléfono pasaba la comprobación de la pantalla y chocaba contra el 400
// del servidor. No es un fallo de validación: es que había **dos reglas para lo mismo**, que es lo
// que §4.8 del contrato dice que no puede pasar. Por eso la decisión vive aquí y las dos pantallas
// la consultan.
//
// 🔴 ESTO NO ES LA BARRERA. La barrera está en el servidor (§4.2) — `apps/api/src/lib/contactos-alta.ts`,
// del que esto es el espejo. Lo de aquí solo evita el viaje y permite apagar el botón antes de
// pulsarlo. Si las dos se separan, manda el servidor.
//
// ⚠️ LA FECHA DE NACIMIENTO NO APARECE EN ESTE MÓDULO, y es lo que vino a arreglar la entrega del
// 2026-08-31: no es obligatoria, así que no puede impedir nada. El campo está en las dos pantallas
// para quien la sepa; lo que no hace es parar un alta.
//
// Los mensajes no nombran columnas ni permisos (§4.7) y son **los mismos textos que devuelve el
// servidor**: si la pantalla dijera una cosa y el 400 otra, parecerían dos problemas distintos.
// ==============================================================================================

import { isEmail } from "./contact-format";

export const FALTA_NOMBRE = "Escribe el nombre del contacto.";
export const FALTA_EMAIL = "Falta el email. Es obligatorio para dar de alta un contacto.";
export const EMAIL_NO_VALIDO = "Ese email no parece válido. Revísalo antes de guardar.";
export const FALTA_TELEFONO = "Falta el teléfono. Es obligatorio para dar de alta un contacto.";

/** Lo que se teclea en cualquiera de los dos formularios de alta. */
export type DatosDeAlta = { nombre: string; email: string; telefono: string };

/**
 * Lo que impide dar de alta, o `null` si no hay nada que lo impida.
 *
 * Devuelve **un solo mensaje**, el del primer campo que falla, en el orden en que están en el
 * formulario. Devolver los tres a la vez suena a formulario roto; de uno en uno se corrigen igual
 * de rápido y se lee mejor. Es el mismo orden y el mismo criterio que el servidor.
 *
 * ⚠️ Dos letras en el nombre, no una: es lo que exige `ContactoFullSchema` en el servidor
 * (`z.string().min(2)`). Con una sola letra la pantalla dejaría pulsar y el 400 llegaría con la
 * lista cruda de zod, que no es un mensaje para nadie.
 */
export function queFaltaParaElAlta(d: DatosDeAlta): string | null {
  if (d.nombre.trim().length < 2) return FALTA_NOMBRE;
  const email = d.email.trim();
  if (!email) return FALTA_EMAIL;
  if (!isEmail(email)) return EMAIL_NO_VALIDO;
  if (!d.telefono.trim()) return FALTA_TELEFONO;
  return null;
}

/**
 * ¿Se puede pulsar «Crear»? Es `queFaltaParaElAlta` sin el mensaje, para el `disabled` del botón.
 *
 * Existe para que el botón y el aviso **no puedan discrepar**: un botón que se apaga con una
 * condición escrita aparte acaba apagándose cuando el aviso dice que todo está bien, o al revés
 * (§4.8). Aquí los dos salen del mismo cálculo.
 */
export function sePuedeDarDeAlta(d: DatosDeAlta): boolean {
  return queFaltaParaElAlta(d) === null;
}
