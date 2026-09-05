/**
 * Los motivos por los que el Drive dice que no, en el idioma de quien lee.
 *
 * 🔴 Esto está fuera del componente porque es la ÚNICA parte comprobable sin navegador (§9.1) y
 * porque el diccionario ya iba por su segunda copia: `moverSeleccion` tenía el suyo y
 * `enviarAPapelera` nació con otro, con los mismos códigos escritos a mano. Dos copias de la
 * misma tabla se separan al primer código nuevo, y separarse aquí significa que una pantalla
 * explica lo que pasó y la otra suelta `forbidden_company_write` a la cara del usuario.
 *
 * ⚠️ La regla que sostiene todo esto (§4.7): **nunca sale a pantalla un identificador interno**.
 * `forbidden_origen` es el nombre de la rama de un `if`; a quien está mirando no le dice nada. Si
 * un código no está en la tabla se usa el respaldo de la acción, que siempre es una frase.
 */

export type AccionDrive = "mover" | "papelera";

/** Lo que significa lo mismo se diga desde donde se diga. */
const COMUNES: Record<string, string> = {
  forbidden_user_folder: "Esa carpeta es el espacio personal de otra persona.",
  forbidden_solo_lectura: "Solo puedes ver estos archivos, no cambiarlos.",
  not_found: "Esa carpeta ya no existe.",
  sin_archivos: "No hay nada seleccionado.",
  sin_archivos_vivos: "Esos archivos ya no están disponibles.",
  demasiados: "Son demasiados archivos de una vez. Hazlo por tandas.",
};

/**
 * Lo que cambia según lo que se estaba intentando.
 *
 * `forbidden_company_write` es el caso que obliga a que esta tabla exista partida en dos: al
 * mover, el servidor lo devuelve por el DESTINO —«no puedes dejar archivos ahí»—; al archivar,
 * por el ORIGEN —«no puedes quitarlos de ahí»—. Un solo texto para los dos casos sería falso en
 * uno de ellos, y un texto falso es peor que uno genérico.
 */
const PROPIOS: Record<AccionDrive, Record<string, string>> = {
  mover: {
    forbidden_origen: "No puedes sacar archivos de esta carpeta.",
    forbidden_company_write: "No puedes dejar archivos en esa carpeta.",
    forbidden_structural: "Esa carpeta no admite archivos: elige una de dentro.",
  },
  papelera: {
    forbidden_company_write: "No tienes permiso para quitar archivos de esa carpeta.",
  },
};

/** Cuando no se reconoce el código. Nunca se enseña el código: se dice qué no se pudo hacer. */
const RESPALDO: Record<AccionDrive, string> = {
  mover: "No se pudieron mover los archivos.",
  papelera: "No se pudieron enviar a la papelera.",
};

export function mensajeDeError(accion: AccionDrive, codigo: unknown): string {
  const clave = typeof codigo === "string" ? codigo : "";
  return PROPIOS[accion][clave] ?? COMUNES[clave] ?? RESPALDO[accion];
}

/** Solo para las pruebas: todos los códigos que esta tabla sabe traducir. */
export function codigosConocidos(accion: AccionDrive): string[] {
  return [...Object.keys(COMUNES), ...Object.keys(PROPIOS[accion])];
}
