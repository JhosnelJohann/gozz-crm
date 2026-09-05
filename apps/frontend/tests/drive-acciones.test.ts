import { describe, it, expect } from "vitest";

import {
  accionesDeArchivo, accionesDeCarpeta, clasesDelContenedorDeMenu, type AccionDrive,
} from "@/lib/drive-acciones";

const nada = () => {};
/** Todo disponible: es el caso de un archivo propio en la carpeta abierta. */
const TODO_ARCHIVO = {
  onPreview: nada, onDownload: nada, onCompartir: nada,
  onDestacar: nada, onRename: nada, onDelete: nada,
};
const TODO_CARPETA = {
  onOpen: nada, onCompartir: nada, onDestacar: nada, onRename: nada, onDelete: nada,
};

const claves = (l: AccionDrive[]) => l.map((a) => a.clave);

describe("las acciones del Drive", () => {
  /**
   * 🔴 LA PRUEBA QUE PAGA ESTE MÓDULO. El 2026-08-25 el menú de la vista de lista tenía compartir
   * y destacar y el del mosaico no, porque eran dos listas escritas a mano. Esto lo fija: si
   * alguien vuelve a separar las dos, aquí se pone rojo.
   */
  it("compartir y destacar están en archivos Y en carpetas", () => {
    for (const lista of [accionesDeArchivo(TODO_ARCHIVO), accionesDeCarpeta(TODO_CARPETA)]) {
      expect(claves(lista)).toContain("compartir");
      expect(claves(lista)).toContain("destacar");
    }
  });

  it("archivo y carpeta comparten el texto de las acciones que comparten", () => {
    const a = accionesDeArchivo(TODO_ARCHIVO);
    const c = accionesDeCarpeta(TODO_CARPETA);
    for (const clave of ["compartir", "destacar", "renombrar", "papelera"] as const) {
      const enArchivo = a.find((x) => x.clave === clave);
      const enCarpeta = c.find((x) => x.clave === clave);
      // Que una diga «Compartir» y la otra «Compartir carpeta» es cómo empieza a divergir.
      expect(enArchivo?.label).toBe(enCarpeta?.label);
    }
  });

  /**
   * 🔴 §0: no se borra nada, se archiva. El botón tiene que decir eso, porque es lo que decide si
   * alguien pulsa con miedo o tranquilo. Decía «Eliminar» y el aviso siguiente lo desmentía.
   */
  it("la acción destructiva dice «papelera» y nunca «eliminar»", () => {
    for (const lista of [accionesDeArchivo(TODO_ARCHIVO), accionesDeCarpeta(TODO_CARPETA)]) {
      const destructivas = lista.filter((a) => a.danger);
      expect(destructivas).toHaveLength(1);
      expect(destructivas[0].label.toLowerCase()).toContain("papelera");
      expect(destructivas[0].label.toLowerCase()).not.toContain("elimin");
      expect(destructivas[0].label.toLowerCase()).not.toContain("borrar");
    }
  });

  it("lo que no se puede hacer, no se dibuja", () => {
    // Un archivo que asoma de una subcarpeta desplegada: solo verlo y descargarlo.
    const soloLectura = accionesDeArchivo({ onPreview: nada, onDownload: nada });
    expect(claves(soloLectura)).toEqual(["ver", "descargar"]);

    // Y sin nada, la lista está vacía: quien dibuja no tiene que defenderse de un menú fantasma.
    expect(accionesDeArchivo({})).toEqual([]);
    expect(accionesDeCarpeta({})).toEqual([]);
  });

  it("el orden es estable: lo de mirar primero, lo destructivo al final", () => {
    expect(claves(accionesDeArchivo(TODO_ARCHIVO)))
      .toEqual(["ver", "descargar", "compartir", "destacar", "renombrar", "papelera"]);
    expect(claves(accionesDeCarpeta(TODO_CARPETA)))
      .toEqual(["abrir", "compartir", "destacar", "renombrar", "papelera"]);
  });

  it("cada acción lleva su propio callback, sin cruzarse", () => {
    const tocadas: string[] = [];
    const lista = accionesDeArchivo({
      onPreview: () => tocadas.push("ver"),
      onCompartir: () => tocadas.push("compartir"),
      onDelete: () => tocadas.push("papelera"),
    });
    for (const a of lista) a.onClick();
    expect(tocadas).toEqual(["ver", "compartir", "papelera"]);
  });
});

describe("el contenedor del menú «…»", () => {
  /**
   * 🔴 La invariante que se rompió el 2026-08-25 y produjo el parpadeo: con el menú ABIERTO,
   * el contenedor no puede desvanecerse ni dejar de recibir el ratón. Si vuelve a depender del
   * `hover`, esto se pone rojo.
   */
  it("abierto: se ve y recibe el ratón, sin depender del hover", () => {
    const c = clasesDelContenedorDeMenu(true);
    expect(c).toContain("opacity-100");
    expect(c).not.toContain("opacity-0");
    expect(c).not.toContain("pointer-events-none");
    expect(c).not.toContain("group-hover");
  });

  /**
   * Y cerrado, la otra mitad del fallo: un botón invisible que se traga los clics. Solo se ve y
   * solo se pulsa con el ratón encima de la tarjeta.
   */
  it("cerrado: invisible Y sin recibir el ratón, hasta que se pasa por encima", () => {
    const c = clasesDelContenedorDeMenu(false);
    expect(c).toContain("opacity-0");
    expect(c).toContain("pointer-events-none");
    expect(c).toContain("group-hover:opacity-100");
    expect(c).toContain("group-hover:pointer-events-auto");
  });
});
