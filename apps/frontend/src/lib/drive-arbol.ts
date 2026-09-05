// ============================================================================================
// LAS SECCIONES DEL ÁRBOL DEL DRIVE — decisiones puras, sin React
//
// Aquí vive lo único de la reorganización del sidebar (reunión del 2026-08-24) que se puede
// comprobar sin un navegador: **qué se pinta, en qué orden y cómo se llama**. Lo demás —el
// colapso, los colores, el chevron— es pintura, y la suite del frontend está en FASE 1: solo
// lógica pura de `src/lib/` (CONVENCIONES §9.1).
//
// 🔴 UNA SOLA FUENTE PARA CADA ETIQUETA. `DriveBrowser` tenía `displayName()` para el árbol y
// `crumbLabel()` para las migas de pan, y las dos traducían `users_root` por su cuenta. Dos
// funciones con opinión propia sobre el mismo dato divergen sin que nada falle: el día que una
// diga «Mi unidad» y la otra «Mi Drive», la pantalla estará llamando a la misma carpeta de dos
// maneras y nadie sabrá cuál es la buena. Las dos llaman ahora a `etiquetaDeCarpeta`.
// ============================================================================================

/**
 * El id del nodo agrupador «Drive Contactos». **No existe en la base**: lo fabrica el backend
 * (`drive-routes.ts` → `ID_NODO_CONTACTOS`) y solo se lo sirve al `super_admin`.
 *
 * 🔴 Si cambia allá, cambia aquí. No hay paquete compartido entre `apps/api` y `apps/frontend`,
 * así que la constante está escrita dos veces; que no tenga forma de uuid es lo que hace que una
 * divergencia se note enseguida —el árbol se quedaría sin la sección— en vez de degradar en
 * silencio.
 */
export const ID_NODO_CONTACTOS = "virtual:contactos";
export const TIPO_NODO_CONTACTOS = "virtual_contactos";

/** Lo mínimo que esta capa necesita saber de una carpeta. */
export interface NodoDeArbol {
  id: string;
  nombre: string;
  tipo: string;
}

/**
 * El orden de las secciones de primer nivel, fijo y a mano.
 *
 * No se ordena por nombre: «Drive de la compañía» iría antes que «Mi unidad» solo por la D, y lo
 * primero que quiere ver alguien al abrir el Drive es lo suyo. Es la misma jerarquía que enseña
 * Google Drive, que es de donde se copió el modelo a propósito.
 */
const ORDEN_SECCIONES: Record<string, number> = {
  users_root: 0,
  company: 1,
  [TIPO_NODO_CONTACTOS]: 2,
};

const ORDEN_DESCONOCIDO = 90;

/** ¿Es el nodo agrupador de las ramas de clientes? */
export function esNodoContactos(id: string | null | undefined): boolean {
  return id === ID_NODO_CONTACTOS;
}

/**
 * Ordena las secciones de primer nivel del Drive (los hijos de la raíz).
 *
 * Lo que no reconoce **no se descarta**: se manda al final ordenado por nombre. Descartarlo
 * escondería una carpeta legítima que alguien creara mañana en la raíz, y esconder por no
 * reconocer es exactamente el fallo silencioso que no queremos.
 */
export function ordenarSecciones<T extends NodoDeArbol>(hijosDeLaRaiz: readonly T[]): T[] {
  return [...hijosDeLaRaiz].sort((a, b) => {
    const pa = ORDEN_SECCIONES[a.tipo] ?? ORDEN_DESCONOCIDO;
    const pb = ORDEN_SECCIONES[b.tipo] ?? ORDEN_DESCONOCIDO;
    if (pa !== pb) return pa - pb;
    return a.nombre.localeCompare(b.nombre, "es");
  });
}

/**
 * Cómo se llama una carpeta EN PANTALLA.
 *
 * `users_root` se llama «Usuarios» en la base porque ahí cuelgan los espacios de todo el equipo,
 * pero cada persona solo ve el suyo: llamarlo «Usuarios» sugiere que se puede fisgar en el de al
 * lado. Se dice «Mi unidad», que es lo que es y lo que pidió Juan.
 */
export function etiquetaDeCarpeta(f: NodoDeArbol): string {
  if (f.tipo === "users_root") return "Mi unidad";
  if (f.tipo === TIPO_NODO_CONTACTOS) return "Drive Contactos";
  return f.nombre;
}

/**
 * Recorta la cadena de migas de pan al ALCANCE en el que se está navegando.
 *
 * Dentro de la pestaña Documentos de una negociación, la cadena que devuelve el servidor es la
 * completa —`Drive del CRM › Trámites › <caso>`— porque el servidor no sabe desde dónde se está
 * mirando. Pintarla tal cual pone un enlace a `Trámites` dentro de la ficha de un caso, y pulsarlo
 * suelta a la persona en el árbol de TODOS los clientes. Eso es lo que se pidió evitar el
 * 2026-08-24: «se acota siempre a exclusivamente esa oportunidad… si quiere navegar, para eso
 * está el apartado de Drive».
 *
 * ⚠️ Si la raíz del alcance NO aparece en la cadena, se devuelve la cadena entera y no una vacía.
 * Quedarse sin migas deja a alguien sin saber dónde está, que es peor que enseñar un tramo de
 * más. Pasa si el dato viene raro; no debería, pero «no debería» no es una garantía.
 */
export function recortarMigas<T extends { id: string }>(cadena: readonly T[], raizDelAlcance: string | null): T[] {
  if (!raizDelAlcance) return [...cadena];
  const i = cadena.findIndex((b) => b.id === raizDelAlcance);
  return i >= 0 ? cadena.slice(i) : [...cadena];
}

/**
 * ¿Pulsar esta carpeta debe abrir su contenido en el panel?
 *
 * El nodo agrupador **no** es una carpeta: no tiene id en la base, así que pedir su contenido
 * daría un 404. Solo se pliega y se despliega. Si algún día alguien lo hace navegable, esta
 * función es donde se entera de que no puede.
 */
export function esNavegable(f: NodoDeArbol): boolean {
  return f.tipo !== TIPO_NODO_CONTACTOS;
}
