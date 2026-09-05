"use client";
import { Share2 } from "@/lib/bootstrap-icons";

import { cn } from "@/lib/utils";

// ============================================================================================
// LA MARCA DE «ESTO ESTA COMPARTIDO» — pedida el 2026-08-25
//
// «Que a los archivos o carpetas que esten compartidas se les coloque una marca de agua o algo que
// los identifique... el icono de compartido en la esquina superior izquierda, y si estan en modo
// lista en la esquina inferior izquierda.»
//
// 🔴 UN SOLO COMPONENTE PARA LOS CUATRO SITIOS que pintan archivos y carpetas (`FileRow`,
// `FileCard`, `FolderCard`, `SubcarpetaFila`). Este repositorio ya se comio esa leccion dos veces
// —cuatro dibujos distintos de la misma miniatura, cuatro visores de archivo— y las dos veces el
// coste fue el mismo: se arregla en uno y los otros tres siguen mal, sin que nada falle.
//
// ⚠️ Va SOBRE la miniatura, no al lado del nombre. Al lado del nombre compite con el texto y se
// pierde en cuanto el nombre es largo; encima de la imagen se lee de un vistazo, que es justo lo
// que se pidio: identificar visualmente sin leer. Por eso sustituye al «muñequito» que iba junto
// al nombre de las carpetas — la misma señal dos veces en la misma fila es ruido.
// ============================================================================================

export function MarcaCompartido({ esquina, className }: {
  /**
   * Las dos que se pidieron, y no hay una tercera a proposito: cada esquina nueva es un sitio mas
   * donde esto puede acabar viendose distinto.
   *
   *   · `arriba` — galeria. La tarjeta es alta y la esquina de arriba esta libre.
   *   · `abajo`  — lista. Ahi el cuadro mide 36–40 px: arriba se solaparia con el borde de la
   *     fila, asi que ademas la marca va un punto mas pequeña. El tamaño sale de aqui y no del
   *     sitio que la usa, para que las dos listas se vean iguales.
   */
  esquina: "arriba" | "abajo";
  /** Solo para recolocar el ancla cuando el contenedor no es una miniatura (p. ej. el icono de
   *  44 px de una carpeta, donde la marca se monta en el vertice en vez de taparlo). */
  className?: string;
}) {
  const enLista = esquina === "abajo";
  return (
    <span
      // `pointer-events-none`: la marca es informacion, no un boton. Sin esto se traga el clic
      // justo en esa esquina y abrir el archivo desde ahi no haria nada.
      className={cn(
        "pointer-events-none absolute z-10 flex items-center justify-center",
        "rounded-md bg-brand-orange text-white shadow-md ring-1 ring-white/60",
        enLista ? "bottom-0.5 left-0.5 h-4 w-4" : "top-1 left-1 h-5 w-5",
        className
      )}
      // El `title` dice lo que significa: el icono solo se entiende si ya lo conoces.
      title="Compartido con otras personas"
      aria-label="Compartido con otras personas"
    >
      <Share2 className={enLista ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={2.6} />
    </span>
  );
}
