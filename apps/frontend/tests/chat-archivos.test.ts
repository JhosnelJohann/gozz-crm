// ============================================================================================
// RECORRER LOS ARCHIVOS DE UNA CONVERSACIÓN — `src/lib/chat-archivos.ts`
//
// Se adjuntaron seis archivos a una tarea, se abrió uno, y no había flechas para pasar al
// siguiente: el chat montaba un visor por mensaje y ningún mensaje sabe qué más hay en la
// conversación.
//
// Lo que se prueba aquí es lo único que puede romperse en silencio: que la lista que recorren las
// flechas sea EXACTAMENTE la que pinta tarjetas de archivo, y que el salto se pare en los extremos.
// Si la lista sobra o falta un elemento, el «2 / 6» miente y la flecha lleva a otro archivo.
//
// 🔴 Fixtures sintéticos (§9.3).
// ============================================================================================

import { describe, expect, it } from "vitest";

import {
  archivosDeLaConversacion,
  esMensajeDeArchivo,
  posicionDeArchivo,
  vecinoDeArchivo,
} from "@/lib/chat-archivos";

const msg = (id: string, tipo: string, archivo_url: string | null = "/uploads/x") => ({ id, tipo, archivo_url });

/** Una conversación de las de verdad: charla suelta, adjuntos y multimedia mezclados. */
const CONVERSACION = [
  msg("t1", "texto", null),
  msg("a1", "archivo"),
  msg("i1", "imagen"),
  msg("a2", "archivo"),
  msg("t2", "texto", null),
  msg("v1", "video"),
  msg("a3", "archivo"),
  msg("au1", "audio"),
];

describe("🔴 qué cuenta como archivo del recorrido", () => {
  it("un mensaje con adjunto que no es multimedia", () => {
    expect(esMensajeDeArchivo(msg("x", "archivo"))).toBe(true);
    expect(esMensajeDeArchivo(msg("x", "documento"))).toBe(true);
  });

  it("un mensaje de texto sin adjunto, no", () => {
    expect(esMensajeDeArchivo(msg("x", "texto", null))).toBe(false);
  });

  it("🔴 imagen, vídeo y audio quedan FUERA, y es a propósito", () => {
    // El chat los reproduce en la propia burbuja, y las imágenes tienen su visor con zoom aparte.
    // Si entraran aquí, la flecha saltaría de un PDF a una nota de voz.
    for (const tipo of ["imagen", "video", "audio"]) {
      expect(esMensajeDeArchivo(msg("x", tipo)), tipo).toBe(false);
    }
  });

  it("⚠️ un mensaje sin `archivo_url` no entra aunque su tipo diga archivo", () => {
    // Pasa con los mensajes borrados: conservan el tipo y pierden el adjunto. Sin esto, el
    // recorrido tendría un hueco que abre el visor sobre nada.
    expect(esMensajeDeArchivo(msg("x", "archivo", null))).toBe(false);
  });
});

describe("la lista del recorrido", () => {
  it("son solo los archivos, y en el orden de la conversación", () => {
    expect(archivosDeLaConversacion(CONVERSACION).map((m) => m.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("una conversación sin adjuntos da una lista vacía, no revienta", () => {
    expect(archivosDeLaConversacion([msg("t", "texto", null)])).toEqual([]);
    expect(archivosDeLaConversacion([])).toEqual([]);
  });
});

describe("dónde estoy: el «2 / 3» de la cabecera", () => {
  const lista = archivosDeLaConversacion(CONVERSACION);

  it("cuenta desde cero y sobre el total de ARCHIVOS, no de mensajes", () => {
    // El total es 3 aunque la conversación tenga 8 mensajes. Contar mensajes daría «2 / 8».
    expect(posicionDeArchivo(lista, "a2")).toEqual({ indice: 1, total: 3 });
    expect(posicionDeArchivo(lista, "a1")).toEqual({ indice: 0, total: 3 });
    expect(posicionDeArchivo(lista, "a3")).toEqual({ indice: 2, total: 3 });
  });

  it("🔴 si el archivo ya no está, devuelve null en vez de un índice inventado", () => {
    // Pasa de verdad: en un chat en vivo alguien puede borrar el mensaje mientras lo miras.
    expect(posicionDeArchivo(lista, "borrado")).toBeNull();
    expect(posicionDeArchivo(lista, null)).toBeNull();
  });
});

describe("🔴 el salto se para en los extremos, no da la vuelta", () => {
  const lista = archivosDeLaConversacion(CONVERSACION);

  it("avanza y retrocede por el medio", () => {
    expect(vecinoDeArchivo(lista, "a1", +1)).toBe("a2");
    expect(vecinoDeArchivo(lista, "a2", +1)).toBe("a3");
    expect(vecinoDeArchivo(lista, "a3", -1)).toBe("a2");
    expect(vecinoDeArchivo(lista, "a2", -1)).toBe("a1");
  });

  it("🔴 en el primero no hay anterior y en el último no hay siguiente", () => {
    // Es donde vive el off-by-one. Con `<=` en vez de `<` el último devolvería `undefined.id` y
    // el visor se quedaría en blanco en vez de desactivar la flecha.
    expect(vecinoDeArchivo(lista, "a1", -1)).toBeNull();
    expect(vecinoDeArchivo(lista, "a3", +1)).toBeNull();
  });

  it("no da la vuelta: del último no se pasa al primero", () => {
    // Distinto del lightbox de imágenes de este mismo chat, que sí la da. Aquí se sigue al Drive y
    // a la ficha del contacto, que desactivan la flecha.
    expect(vecinoDeArchivo(lista, "a3", +1)).not.toBe("a1");
  });

  it("con un solo archivo no hay a dónde ir por ningún lado", () => {
    const uno = archivosDeLaConversacion([msg("solo", "archivo")]);
    expect(vecinoDeArchivo(uno, "solo", +1)).toBeNull();
    expect(vecinoDeArchivo(uno, "solo", -1)).toBeNull();
    expect(posicionDeArchivo(uno, "solo")).toEqual({ indice: 0, total: 1 });
  });

  it("un id que no está en la lista no mueve nada", () => {
    expect(vecinoDeArchivo(lista, "borrado", +1)).toBeNull();
    expect(vecinoDeArchivo(lista, null, +1)).toBeNull();
  });
});
