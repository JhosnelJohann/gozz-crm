// ============================================================================================
// ¿QUE ARCHIVOS PIDEN MINIATURA? — `src/lib/miniaturas.ts`
//
// Es la conjetura del cliente sobre lo que el servidor sabra rasterizar. La regla de verdad vive
// en `apps/api/src/lib/drive-thumbs.ts` y estas dos TIENEN QUE DECIR LO MISMO: si el cliente es
// mas optimista, cada tarjeta de mas es una peticion garantizada a 404; si es mas pesimista, se
// pierden miniaturas que el servidor sabia hacer.
//
// El `onError` del `<img>` cubre la discrepancia sin romper nada, y por eso esto puede permitirse
// ser aproximado — pero no puede permitirse estar equivocado en los tipos frecuentes.
//
// 🔴 Fixtures sinteticos (§9.3): nombres de archivo inventados.
// ============================================================================================

import { describe, expect, it } from "vitest";

import { bajaElArchivoEntero, puedeTenerMiniatura, urlDeMiniatura } from "@/lib/miniaturas";

describe("lo que si pide miniatura", () => {
  it("las imagenes que el servidor sabe reducir", () => {
    for (const n of ["foto.jpg", "foto.jpeg", "captura.png", "imagen.webp", "animado.gif"]) {
      expect(puedeTenerMiniatura(null, n), n).toBe(true);
    }
  });

  it("🔴 los PDF, que son la mitad de la razon de ser de esta etapa", () => {
    // ~2 de cada 3 documentos de una ficha son PDF. Si esto devolviera false, la Etapa 2 no se
    // notaria en la pantalla donde mas falta hacia.
    expect(puedeTenerMiniatura("application/pdf", "i589.pdf")).toBe(true);
    expect(puedeTenerMiniatura(null, "contrato.pdf")).toBe(true);
    expect(puedeTenerMiniatura("application/pdf", "sin-extension")).toBe(true);
  });

  it("🔴 sin mime tambien: es el caso corriente en lo importado de Pipedrive y Zoho", () => {
    // Son justo los archivos de la ficha del contacto. Mirando solo el mime, esa galeria no
    // pediria ni una miniatura y la entrega no se veria.
    expect(puedeTenerMiniatura(null, "pasaporte.jpg")).toBe(true);
    expect(puedeTenerMiniatura(undefined, "acta.pdf")).toBe(true);
    expect(puedeTenerMiniatura("", "escaneo.PNG"), "y la extension no distingue mayusculas").toBe(true);
  });

  it("la variante no estandar `image/jpg` que aparece en datos importados", () => {
    expect(puedeTenerMiniatura("image/jpg", "x")).toBe(true);
  });
});

describe("lo que NO la pide", () => {
  it("🔴 un HEIC no, aunque su mime empiece por `image/`", () => {
    // Es la razon de que la lista sea explicita en vez de un `startsWith("image/")`: ningun
    // navegador los pinta y el servidor tampoco los sabe leer, asi que pedirla es un 404 seguro.
    expect(puedeTenerMiniatura("image/heic", "foto.heic")).toBe(false);
    expect(puedeTenerMiniatura(null, "foto.heic")).toBe(false);
    expect(puedeTenerMiniatura("image/heif", "x")).toBe(false);
  });

  it("un svg tampoco: es texto y se rasteriza distinto", () => {
    expect(puedeTenerMiniatura("image/svg+xml", "dibujo.svg")).toBe(false);
  });

  it("los documentos de oficina y lo demas", () => {
    for (const [m, n] of [[null, "nota.docx"], [null, "hoja.xlsx"], [null, "comprimido.zip"],
                          ["audio/mpeg", "audio.mp3"], ["video/mp4", "video.mp4"]] as const) {
      expect(puedeTenerMiniatura(m, n), n).toBe(false);
    }
  });

  it("no revienta con entradas vacias", () => {
    expect(puedeTenerMiniatura(null, null)).toBe(false);
    expect(puedeTenerMiniatura(undefined, undefined)).toBe(false);
    expect(puedeTenerMiniatura("", "")).toBe(false);
    expect(puedeTenerMiniatura(null, "sin-punto")).toBe(false);
  });
});

describe("de dónde se piden los bytes de una miniatura", () => {
  it("con id de Drive, del endpoint de miniatura", () => {
    expect(urlDeMiniatura({ id: "abc" })).toBe("/api/drive/files/abc/thumb");
  });

  it("🔴 el id MANDA sobre la url directa: cuando existe, siempre es la opción barata", () => {
    // /thumb devuelve ~320 px; la url directa sirve el archivo entero. Preferir la url cuando hay
    // id sería volver al problema que esta serie de entregas vino a arreglar.
    expect(urlDeMiniatura({ id: "abc", urlDirecta: "/uploads/foto.jpg" })).toBe("/api/drive/files/abc/thumb");
  });

  it("sin id, la url directa — que sí baja el archivo entero, y se sabe", () => {
    // Es la rama de /uploads del panel de sin identificar. No hay endpoint de miniatura para esos
    // ficheros, y quitarles la vista previa para ahorrar bytes no sería un arreglo.
    expect(urlDeMiniatura({ urlDirecta: "/uploads/foto.jpg" })).toBe("/uploads/foto.jpg");
    expect(bajaElArchivoEntero({ urlDirecta: "/uploads/foto.jpg" })).toBe(true);
    expect(bajaElArchivoEntero({ id: "abc" }), "con id no: pide la miniatura").toBe(false);
  });

  it("sin nada, no hay de dónde pedirla", () => {
    expect(urlDeMiniatura({})).toBeNull();
    expect(urlDeMiniatura({ id: null, urlDirecta: null })).toBeNull();
    expect(urlDeMiniatura({ id: "", urlDirecta: "" })).toBeNull();
  });
});
