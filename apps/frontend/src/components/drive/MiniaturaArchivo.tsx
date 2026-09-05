"use client";
import { useState, type ReactNode } from "react";
import { useInView } from "react-intersection-observer";
import { cn } from "@/lib/utils";
import { bajaElArchivoEntero, puedeTenerMiniatura, urlDeMiniatura } from "@/lib/miniaturas";
import { fileVisual } from "./file-visual";

// ============================================================================================
// LA MINIATURA DE UN ARCHIVO — un solo sitio, para las cuatro pantallas que pintan archivos
//
// Esto no inventa nada: **extrae lo que ya funcionaba dentro de `FileThumbCard`** y lo pone donde
// puedan usarlo los demas. Antes de esto habia cuatro comportamientos distintos para la misma
// cosa, y dos de ellos eran el fallo que ya se habia arreglado en la ficha del contacto:
//
//   · la fila de la lista de la ficha  → un icono FIJO, nunca una miniatura;
//   · `FileRow` del Drive              → `<img src=".../raw">`, el ARCHIVO ENTERO para 40 px;
//   · `FileCard` del Drive             → `<img src=".../raw">`, el ARCHIVO ENTERO para una tarjeta;
//   · `FileThumbCard`                  → lo correcto, y solo ahi.
//
// 🔴 LAS DOS COSAS QUE HACE, Y POR QUE NINGUNA SOBRA:
//   · `IntersectionObserver` decide **si se pone el `src`**. Sin direccion no hay peticion, y esa
//     es la barrera de verdad — `loading="lazy"` va ademas, pero es solo una SUGERENCIA que el
//     navegador puede adelantar. Medido en produccion: 25 MB en una sola ficha.
//   · el `src` apunta a **`/thumb`, nunca a `/raw`**. `/raw` devuelve el archivo entero: 291,6 KB
//     frente a 8,7 KB medidos sobre el mismo fichero, 33 veces menos. La carga perezosa acota
//     CUANDO se paga; la miniatura acota CUANTO.
//
// Quien decide si un archivo puede tener miniatura es `lib/miniaturas.ts`, que ya tiene sus
// pruebas. Aqui no se duplica esa regla, ni se inventa un segundo mapa de iconos: el respaldo sale
// de `fileVisual()`, el mismo del Drive.
//
// ⚠️ RELLENA SU CONTENEDOR. El tamanio y la forma los pone quien lo usa, para que sirva igual en
// un cuadro de 36 px que en una tarjeta 4:3.
//
// 🔴 Y SE POSICIONA A SI MISMO. Antes esto pintaba `absolute inset-0` directamente y AVISABA aqui
// de que el contenedor de fuera necesitaba `relative`. Ese aviso no basto: el 2026-08-25, en
// staging, un `pikachu.png` compartido ocupo la pantalla ENTERA de «Compartidos conmigo». Los tres
// paneles nuevos habian puesto el cuadro de 36 px sin `relative`, asi que `absolute` se midio
// contra la pagina.
//
// Es la misma leccion que CONVENCIONES §4.9, la del visor que se pintaba dentro de una burbuja de
// chat: **la garantia va en el componente que la promete, no en quien lo usa**. Si vive en quien
// llama, el siguiente que lo monte reabre el defecto sin enterarse — y aqui hubo tres seguidos.
// Ahora el envoltorio trae su propio `relative h-full w-full`, asi que basta con darle una caja
// con tamanio. `overflow-hidden` sigue siendo cosa de fuera: es la forma (el redondeo), no la
// posicion.
// ============================================================================================

export function MiniaturaArchivo({ file, urlDirecta, fallback, superponerAlPasar = false, className }: {
  /** `id` es opcional: hay origenes que no estan en `drive_files`. Ver `urlDirecta`. */
  file: { id?: string; nombre: string; mime: string | null };
  /**
   * De donde sacar la imagen cuando el archivo NO tiene id de Drive.
   *
   * 🔴 ESA URL SIRVE EL ARCHIVO ENTERO, y se usa igualmente. El panel de archivos sin identificar
   * tambien lista ficheros de `/uploads/`, que no estan en `drive_files` y para los que **no
   * existe endpoint de miniatura**. Quitarles la vista previa para ahorrar bytes no seria un
   * arreglo — seria arreglar el peso a costa de una funcionalidad.
   *
   * Aun asi pasan por aqui y no por un `<img>` a mano, para heredar lo que ya funciona: la carga
   * perezosa —que es lo que de verdad acota el gasto— y la caida al icono si la imagen falla.
   *
   * Montar un `/thumb` para `/uploads` es otra entrega: no hay `sha256` con el que componer la
   * clave de cache, y eso hay que decidirlo aparte.
   */
  urlDirecta?: string | null;
  /**
   * Que pintar cuando NO hay miniatura. Si no se pasa, sale el icono de color de `fileVisual()`
   * centrado y pequenio, que es lo que quiere una fila.
   *
   * Existe porque las cuatro pantallas dibujan ese respaldo distinto —una lo anima al pasar por
   * encima, otra lo quiere grande, otra diminuto—, y **cambiar cualquiera de esos dibujos seria
   * cambiar el aspecto de una pantalla que hoy funciona**. Lo que se comparte es la decision y la
   * peticion; el adorno se queda donde estaba.
   */
  fallback?: ReactNode;
  /**
   * Si hay miniatura, pintar ADEMAS el respaldo encima, revelado al pasar el raton.
   *
   * Es el comportamiento que ya tiene `FileRow` del Drive: la miniatura se tapa con el gradiente
   * y el icono al pasar por encima. Se conserva tal cual, y por eso es una prop y no una decision
   * tomada aqui: en las tarjetas ese mismo efecto taparia la imagen justo cuando se mira.
   */
  superponerAlPasar?: boolean;
  className?: string;
}) {
  const v = fileVisual(file.mime, file.nombre);

  // `triggerOnce`: una vez pedida, no se descarta al salir de pantalla — volver a pedirla al subir
  // el scroll costaria mas que dejarla en la cache del navegador.
  // `rootMargin`: se empieza 300 px antes de asomar, para que llegue ya cargada.
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "300px 0px" });

  // Si el servidor responde 404 —un `.docx`, un HEIC, un archivo corrupto, un PDF que no se supo
  // rasterizar— o la imagen no se puede pintar, se cae al icono. Sin esto quedaria el cuadro roto
  // del navegador, que es peor que un icono: parece una averia en vez de un tipo sin vista previa.
  const [fallo, setFallo] = useState(false);
  const src = urlDeMiniatura({ id: file.id, urlDirecta });
  const hayMiniatura = !!src && puedeTenerMiniatura(file.mime, file.nombre) && !fallo;

  const respaldo = fallback ?? (
    <div className={cn("absolute inset-0 bg-gradient-to-br flex items-center justify-center", v.gradient)}>
      <v.Icon className="h-5 w-5 text-white" strokeWidth={2.2} />
    </div>
  );

  return (
    // `relative h-full w-full`: el marco contra el que se miden los `absolute` de dentro. Ver la
    // nota de la cabecera — esto estuvo fuera y costo un Pikachu a pantalla completa.
    <div ref={ref} className={cn("relative h-full w-full", className)}>
      {hayMiniatura && inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // Con id, `/thumb` (~320 px). Sin el, la url directa — que baja el archivo entero, y
          // esta dicho en `urlDeMiniatura`. La regla vive en `lib/miniaturas.ts`, con pruebas.
          src={src!}
          alt={file.nombre}
          // `title` solo donde el coste es real, para que no sea ruido en las cuatro pantallas
          // que si piden miniatura de verdad.
          title={bajaElArchivoEntero({ id: file.id, urlDirecta }) ? "Vista previa a tamanio completo: este archivo todavia no esta en el Drive" : undefined}
          loading="lazy"
          decoding="async"
          onError={() => setFallo(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Sin miniatura: el respaldo, y ya. Con miniatura y `superponerAlPasar`: el respaldo encima,
          invisible hasta que el raton entra — es el efecto que ya tenia la fila del Drive. */}
      {!hayMiniatura ? respaldo
        : superponerAlPasar ? <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition">{respaldo}</div>
        : null}
    </div>
  );
}
