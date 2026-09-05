import type { DriveFile } from "@/components/drive/DriveBrowser";

// ============================================================================================
// LOS DOCUMENTOS IMPORTADOS DE UN CONTACTO — un solo recorrido para las tres vistas
//
// La pestania Documentos los ensenia de tres formas: la lista agrupada por carpeta, la galeria
// de miniaturas, y las flechas del visor que van de uno al siguiente. Las tres tienen que estar
// de acuerdo en QUE archivos hay y en QUE ORDEN.
//
// 🔴 POR ESO ESTO DEVUELVE LAS DOS FORMAS DE UNA SOLA PASADA. Si la lista, la galeria y el
// navegador calcularan cada uno su propio recorrido, el dia que alguien toque uno el «3 / 47»
// empezaria a mentir **sin que nada falle**: seguiria diciendo 47, seguiria avanzando, y estaria
// ensenando otro archivo del que el usuario cree. Un fallo que no se cae es peor que uno que si.
//
// El indice de navegacion viaja DENTRO de cada elemento (`indice`), asi que quien pinta una
// tarjeta no tiene que buscar su posicion en la lista para poder abrirla: se la pasa y ya.
// Buscar por `id` seria el segundo sitio donde el orden podria discrepar.
//
// Funcion PURA y exportada a proposito: es la unica pieza de esta entrega razonablemente
// testeable, y `apps/frontend` todavia no tiene runner de pruebas (declarado en el plan).
// ============================================================================================

/** Un archivo, con de que carpeta viene y que puesto ocupa en el recorrido completo. */
export interface DocumentoAplanado {
  file: DriveFile;
  /** Posicion en `planos`, empezando en 0. Es lo que alimenta el «3 / 47» del visor. */
  indice: number;
  folderId: string;
  folderNombre: string;
}

/** Una carpeta con sus archivos ya convertidos, en el mismo orden en que se pintan. */
export interface GrupoDocumentos {
  folderId: string;
  folderNombre: string;
  archivos: DocumentoAplanado[];
}

export interface DocumentosAplanados {
  /** Para la vista de lista, que sigue agrupando por carpeta. */
  grupos: GrupoDocumentos[];
  /** Para la galeria y para las flechas del visor: todos los archivos de punta a punta. */
  planos: DocumentoAplanado[];
  /**
   * Los grupos que llegaron SIN archivos (T3, 2026-08-24).
   *
   * Desde que la pestania se organiza por negociacion, una negociacion sin documentos tiene que
   * verse: que no salga se lee como que esa negociacion no existe, y el usuario acaba buscandola
   * en el Drive. Se devuelven APARTE y no dentro de `grupos` a proposito — `grupos` alimenta lo
   * que se recorre, y un grupo vacio ahi seria un hueco en el que la flecha se pararia.
   */
  vacios: { folderId: string; folderNombre: string }[];
}

/**
 * Convierte las carpetas que devuelve la API en las dos formas que consume la pantalla.
 *
 * Respeta el orden tal cual llega —la API ya ordena carpetas y archivos por nombre— y aplica el
 * MISMO filtro de siempre: **una carpeta sin archivos no se pinta**, asi que tampoco cuenta para
 * el recorrido. Si contara, las flechas se pararian en huecos invisibles.
 *
 * ⚠️ El recorrido IGNORA si la carpeta esta plegada o desplegada. Plegar es una preferencia de
 * quien mira, no una seleccion: los 47 son 47 aunque solo se vean 6.
 *
 * Tolera lo que la API pueda no mandar (`folders` ausente, `files` nulo) devolviendo vacio en vez
 * de romper la pestania: son tres fuentes distintas fusionadas —Pipedrive, Zoho y Bitrix— y basta
 * con que una devuelva algo raro.
 */
export function aplanarDocumentos(folders: any): DocumentosAplanados {
  const grupos: GrupoDocumentos[] = [];
  const planos: DocumentoAplanado[] = [];
  const vacios: { folderId: string; folderNombre: string }[] = [];

  for (const folder of Array.isArray(folders) ? folders : []) {
    // 🔴 El guard va ANTES de leer nada de `folder`. Antes de la T3 no hacia falta porque lo
    // primero que se tocaba era `folder?.files` con encadenamiento opcional; al mover la lectura
    // del id delante —para poder anotar los grupos vacios— una entrada `null` empezo a lanzar.
    // Lo cazó la prueba que ya existia, y por eso esta linea esta aqui y no mas abajo.
    if (!folder || typeof folder !== "object") continue;
    const files = Array.isArray(folder.files) ? folder.files : [];
    const folderId = String(folder.folder_id ?? "");
    const folderNombre = String(folder.folder_nombre ?? "");
    if (files.length === 0) { vacios.push({ folderId, folderNombre }); continue; }

    const archivos: DocumentoAplanado[] = [];

    for (const f of files) {
      // 🔴 UNA GUARDA PARA CUATRO FORMAS MALAS, Y LAS DOS QUE IMPORTAN NO SON LAS QUE LANZAN.
      //
      //   [null, {…}]       -> antes: TypeError leyendo `.id`
      //   [undefined, {…}]  -> antes: TypeError, misma causa
      //   ["nope"]          -> antes: NO lanzaba. Devolvia un elemento con `file.id === undefined`
      //   [7]               -> antes: NO lanzaba. Igual
      //
      // Por eso se comprueba que haya un `id` USABLE y no solo que la entrada no sea nula: un
      // TypeError se ve y se arregla, pero un elemento con `id: undefined` pinta una tarjeta con
      // `key={undefined}` y un enlace de descarga a `/api/drive/files/undefined/download`. No
      // falla: MIENTE, y se descubre cuando alguien pulsa. Lo que no lanza es lo que hay que temer.
      //
      // Se salta la entrada mala y se sigue con las buenas: la pestania fusiona tres fuentes, y
      // que una mande basura no puede costarle al usuario los archivos de las otras dos.
      if (!f || typeof f !== "object" || !f.id) continue;

      // La misma forma de `DriveFile` que la lista construia a mano. Que la construya un solo
      // sitio es lo que garantiza que la tarjeta, la fila y el visor hablen del mismo objeto.
      const file: DriveFile = {
        id: f.id,
        folder_id: folderId,
        nombre: f.nombre,
        mime: f.mime ?? null,
        size_bytes: f.size_bytes ?? null,
        uploaded_by: "",
        created_at: f.created_at,
        updated_at: f.created_at,
      };
      const doc: DocumentoAplanado = { file, indice: planos.length, folderId, folderNombre };
      archivos.push(doc);
      planos.push(doc);
    }

    // El filtro de "carpeta sin archivos no se pinta" se comprueba OTRA VEZ aqui, y no basta con
    // el `files.length === 0` de arriba: aquel mira lo que LLEGO, y este lo que QUEDO despues de
    // descartar la basura. Una carpeta cuyas entradas fueran todas invalidas pasaria el primero y
    // acabaria en la lista como una cabecera desplegable sin nada dentro.
    if (archivos.length === 0) { vacios.push({ folderId, folderNombre }); continue; }

    grupos.push({ folderId, folderNombre, archivos });
  }

  return { grupos, planos, vacios };
}
