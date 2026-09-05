import type { DriveFile } from "@/components/drive/DriveBrowser";

// ============================================================================================
// EL RECORRIDO DEL PANEL DEL DRIVE — un solo orden para lo que se pinta y para las flechas
//
// Desde la T2 el panel puede enseñar más archivos de los que tiene la carpeta abierta: en la
// vista de lista, cada subcarpeta se despliega con su flechita y muestra los suyos ahí mismo,
// y se pueden tener varias abiertas a la vez. Fue lo que se pidió el 2026-08-24: «que si tú la
// abres, se abre lo que tiene adentro… y puedes ver ambas a la vez».
//
// 🔴 POR QUÉ ESTO ES UN MÓDULO Y NO UN `.map()` DENTRO DEL COMPONENTE.
//
// El visor guarda el ÍNDICE dentro del recorrido, no el archivo (está escrito en `DriveBrowser`,
// y es lo correcto: con el índice, avanzar es sumar uno). Hasta hoy ese índice apuntaba a
// `pageFiles`, los archivos de la carpeta abierta, porque no había nada más en pantalla.
//
// En cuanto una subcarpeta desplegada añade archivos a la vista, «lo que se ve» y «lo que
// caminan las flechas» dejan de ser la misma lista — y el fallo NO SE CAE: el contador seguiría
// diciendo «3 / 12», la flecha seguiría avanzando, y estaría enseñando un archivo distinto del
// que el usuario cree tener delante. En un CRM de inmigración eso es enseñar el pasaporte de
// otra persona. Un fallo que no se cae es peor que uno que sí.
//
// Es la misma regla de `CONVENCIONES §4.8` —quien clasifica y quien escribe comparten las
// fronteras— y el mismo remedio que ya se aplicó en `lib/documentos-contacto.ts` para la ficha
// del contacto: **una sola pasada devuelve las dos formas**, y el índice viaja DENTRO de cada
// elemento para que quien pinta una fila no tenga que buscar su posición.
// ============================================================================================

/** Un archivo con el puesto que ocupa en el recorrido y de qué carpeta sale. */
export interface ArchivoEnRecorrido {
  file: DriveFile;
  /** Posición en `planos`, empezando en 0. Es lo que alimenta el «3 / 12» del visor. */
  indice: number;
  /** `null` si es de la carpeta abierta; el id de la subcarpeta si vino de una desplegada. */
  subcarpetaId: string | null;
  subcarpetaNombre: string | null;
}

export interface Recorrido {
  /** Por subcarpeta desplegada, sus archivos: lo que se pinta debajo de su fila. */
  porSubcarpeta: Record<string, ArchivoEnRecorrido[]>;
  /** Los de la carpeta abierta. */
  propios: ArchivoEnRecorrido[];
  /** Todo, EN EL ORDEN EN QUE SE VE. Es lo que caminan las flechas. */
  planos: ArchivoEnRecorrido[];
}

export interface EntradaRecorrido {
  /** Las subcarpetas de la página, en el orden en que se pintan. */
  subcarpetas: readonly { id: string; nombre: string }[];
  /** Cuáles están desplegadas ahora mismo. */
  desplegadas: ReadonlySet<string>;
  /** Los archivos ya traídos de cada subcarpeta. Puede faltar una que aún esté cargando. */
  archivosPorSubcarpeta: Readonly<Record<string, readonly DriveFile[] | undefined>>;
  /** Los archivos de la carpeta abierta, tal como los devuelve el servidor. */
  archivosPropios: readonly DriveFile[];
}

/**
 * Construye el recorrido en el MISMO orden en que se pinta: primero las subcarpetas —cada una
 * con los suyos si está desplegada— y después los archivos de la carpeta abierta.
 *
 * ⚠️ Una subcarpeta desplegada **que todavía no ha traído sus archivos no aporta nada** y no deja
 * hueco: los índices salen siempre seguidos, de 0 a n−1. Si dejara hueco, la flecha se pararía en
 * un archivo que no existe mientras la petición está en vuelo.
 *
 * ⚠️ En la vista de mosaico no hay desplegables. Quien llama pasa `desplegadas` vacío, y entonces
 * el recorrido es exactamente el de siempre. **La decisión de qué se ve la toma quien pinta**;
 * esta función solo garantiza que las flechas caminen eso mismo y no otra cosa.
 */
export function construirRecorrido(entrada: EntradaRecorrido): Recorrido {
  const porSubcarpeta: Record<string, ArchivoEnRecorrido[]> = {};
  const planos: ArchivoEnRecorrido[] = [];

  const anota = (file: DriveFile, subcarpetaId: string | null, subcarpetaNombre: string | null): ArchivoEnRecorrido => {
    const item: ArchivoEnRecorrido = { file, indice: planos.length, subcarpetaId, subcarpetaNombre };
    planos.push(item);
    return item;
  };

  for (const sub of entrada.subcarpetas) {
    if (!entrada.desplegadas.has(sub.id)) continue;
    const archivos = entrada.archivosPorSubcarpeta[sub.id];
    if (!Array.isArray(archivos) || archivos.length === 0) continue;   // aún cargando, o vacía
    porSubcarpeta[sub.id] = archivos.map((f) => anota(f, sub.id, sub.nombre));
  }

  const propios = entrada.archivosPropios.map((f) => anota(f, null, null));

  return { porSubcarpeta, propios, planos };
}
