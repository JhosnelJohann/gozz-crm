// ==============================================================================================
// QUÉ SE PUEDE HACER CON UN ARCHIVO O UNA CARPETA — una sola lista para todos los sitios
//
// Pedido el 2026-08-25: «en el modo de visualización mosaico no aparecen las opciones nuevas,
// compartir y destacar», y «deben estar las opciones cuando se despliega la modal».
//
// 🔴 EL FALLO NO FUE UN OLVIDO, FUE LA FORMA. Había cuatro menús escritos a mano —fila de
// archivo, tarjeta de archivo, tarjeta de carpeta, fila de carpeta— y el visor como quinto sitio
// con dos botones sueltos. Compartir y destacar entraron en dos de los cinco. Nada falla cuando un
// menú tiene menos opciones que otro: no hay error de tipos, no hay prueba que se ponga roja, y la
// pantalla se ve perfectamente bien. Solo la nota quien va a buscar una opción y no está.
//
// Es `CONVENCIONES §4.8` una vez más: quien decide y quien dibuja tienen que compartir las
// fronteras. Aquí se decide **una** vez qué se ofrece y cómo se llama; los sitios solo eligen la
// forma (menú desplegable o botones).
//
// ⚠️ **Sin iconos a propósito.** `src/lib/` no importa componentes de icono —ningún módulo de aquí lo
// hace— porque es la capa que se prueba sin navegador (§9.1). El icono lo pone quien dibuja,
// buscándolo por `clave`.
// ==============================================================================================

export type ClaveAccion =
  | "ver" | "abrir" | "descargar" | "compartir" | "destacar" | "renombrar" | "papelera";

export interface AccionDrive {
  clave: ClaveAccion;
  /** Lo que lee la persona. */
  label: string;
  onClick: () => void;
  /** Se pinta en rojo. Solo la papelera. */
  danger?: boolean;
}

/**
 * 🔴 «Enviar a la papelera», nunca «Eliminar».
 *
 * Los dos endpoints que hay detrás —el de un archivo y el de una carpeta— hacen archivado lógico
 * y reversible (§0): ponen `deleted_at` y `ciclo='papelera'`, y la papelera restaura. El botón
 * decía «Eliminar» y el aviso siguiente tenía que desmentirlo con un «se moverá a la papelera».
 * Un botón que dice una cosa y un aviso que dice otra enseña a no leer los avisos.
 */
const ETIQUETA_PAPELERA = "Enviar a la papelera";

/**
 * Cada callback es opcional, y esa es la única puerta: **quien no puede hacer algo no recibe su
 * callback**, y entonces la acción no existe. Los permisos se deciden donde se conoce la carpeta
 * —y de verdad en el servidor—; esto solo deja de dibujar lo que no procede.
 */
export function accionesDeArchivo(o: {
  onPreview?: () => void;
  onDownload?: () => void;
  onCompartir?: () => void;
  onDestacar?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}): AccionDrive[] {
  const lista: AccionDrive[] = [];
  if (o.onPreview) lista.push({ clave: "ver", label: "Ver", onClick: o.onPreview });
  if (o.onDownload) lista.push({ clave: "descargar", label: "Descargar", onClick: o.onDownload });
  if (o.onCompartir) lista.push({ clave: "compartir", label: "Compartir", onClick: o.onCompartir });
  if (o.onDestacar) lista.push({ clave: "destacar", label: "Destacar", onClick: o.onDestacar });
  if (o.onRename) lista.push({ clave: "renombrar", label: "Renombrar", onClick: o.onRename });
  if (o.onDelete) lista.push({ clave: "papelera", label: ETIQUETA_PAPELERA, onClick: o.onDelete, danger: true });
  return lista;
}

/** Lo mismo para las carpetas. La primera acción es abrirla, no verla. */
export function accionesDeCarpeta(o: {
  onOpen?: () => void;
  onCompartir?: () => void;
  onDestacar?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}): AccionDrive[] {
  const lista: AccionDrive[] = [];
  if (o.onOpen) lista.push({ clave: "abrir", label: "Abrir", onClick: o.onOpen });
  if (o.onCompartir) lista.push({ clave: "compartir", label: "Compartir", onClick: o.onCompartir });
  if (o.onDestacar) lista.push({ clave: "destacar", label: "Destacar", onClick: o.onDestacar });
  if (o.onRename) lista.push({ clave: "renombrar", label: "Renombrar", onClick: o.onRename });
  if (o.onDelete) lista.push({ clave: "papelera", label: ETIQUETA_PAPELERA, onClick: o.onDelete, danger: true });
  return lista;
}

// ==============================================================================================
// EL CONTENEDOR DEL MENÚ «…»
//
// 🔴 Una regla, y la rompimos el 2026-08-25: **mientras el menú está abierto, su contenedor
// se ve y recibe el ratón, pase lo que pase**. Estaba dentro de un `opacity-0
// group-hover:opacity-100`, así que al salir el ratón el menú seguía abierto pero invisible —y
// reaparecía «solo» al volver a pasar por encima—. Y como un elemento con `opacity: 0` **sigue
// recibiendo el ratón**, la capa que cierra al pulsar fuera se quedaba tapando la pantalla,
// invisible y activa; siendo hija de la tarjeta, el navegador la contaba como «ratón encima» y el
// `group-hover` se realimentaba: ese era el parpadeo de medio segundo.
//
// Está aquí —y no suelto en el `className`— solo para poder fijarlo con una prueba. Es lo único
// de esta pantalla que se puede comprobar sin navegador.
// ==============================================================================================

export function clasesDelContenedorDeMenu(abierto: boolean): string {
  return abierto
    ? "opacity-100"
    : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto";
}
