// ============================================================================================
// LAS MINIATURAS DEL DRIVE — `src/lib/drive-thumbs.ts`
//
// Lo que se prueba aquí son las DECISIONES, que es donde están los fallos caros: qué herramienta
// toca, si el archivo pasa del tope, y —sobre todo— **cuál es la clave de caché**.
//
// 🔴 NADA DE ESTO DEPENDE DE QUE LA MÁQUINA TENGA `sharp` NI `pdftoppm`. `pdftoppm` es un paquete
// del SISTEMA que no controla el repositorio: una suite que solo pasa donde está instalado no es
// una suite, es una coincidencia. La generación en sí se simula.
//
// 🔴 El caso que más importa es `sha256` nulo. Una clave de caché equivocada sirve la miniatura de
// OTRO documento, y en un CRM de inmigración eso es enseñarle a alguien el pasaporte de otra
// persona. Por eso hay una prueba dedicada a que **no se invente una clave** cuando no hay hash.
//
// 🔴 Fixtures sintéticos (§9.3): nombres de archivo inventados y hashes de mentira.
// ============================================================================================

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANCHO_MINIATURA,
  MAX_GENERACIONES_SIMULTANEAS,
  TAMANO_MAXIMO_ENTRADA,
  claveMiniatura,
  conSemaforo,
  decidir,
  elegirHerramienta,
  superaElTope,
} from "../src/lib/drive-thumbs.js";

const SHA = "a".repeat(64);

/** Una fila de `drive_files` con lo justo que mira `decidir`. */
const fila = (over: Partial<{ nombre: string; mime: string | null; size_bytes: unknown; sha256: string | null }> = {}) => ({
  nombre: "documento.pdf",
  mime: "application/pdf",
  size_bytes: 1024,
  sha256: SHA,
  ...over,
});

afterEach(() => { vi.restoreAllMocks(); });

describe("qué herramienta rasteriza cada cosa", () => {
  it("un PDF va a pdftoppm, por mime y por extensión", () => {
    expect(elegirHerramienta("contrato.pdf", "application/pdf")).toBe("pdftoppm");
    expect(elegirHerramienta("contrato.pdf", null), "sin mime, por la extensión").toBe("pdftoppm");
    expect(elegirHerramienta("sin-extension", "application/pdf"), "sin extensión, por el mime").toBe("pdftoppm");
  });

  it("las imágenes que sharp lee sin plugins van a sharp", () => {
    for (const n of ["foto.jpg", "foto.jpeg", "captura.png", "imagen.webp", "animado.gif"]) {
      expect(elegirHerramienta(n, null), n).toBe("sharp");
    }
    expect(elegirHerramienta("foto.JPG", null), "la extensión no distingue mayúsculas").toBe("sharp");
    expect(elegirHerramienta("x", "image/png")).toBe("sharp");
    expect(elegirHerramienta("x", "image/jpg"), "variante no estándar de datos importados").toBe("sharp");
  });

  it("🔴 el mime NULO no impide reconocer el archivo — es el caso corriente en lo importado", () => {
    // Los archivos que llegan de Pipedrive y Zoho vienen sin `mime`, y son justo los que se ven en
    // la ficha del contacto. Mirando solo el mime, esa galería no enseñaría ni una miniatura.
    expect(elegirHerramienta("pasaporte.jpg", null)).toBe("sharp");
    expect(elegirHerramienta("i589.pdf", undefined)).toBe("pdftoppm");
    expect(elegirHerramienta("escaneo.png", "")).toBe("sharp");
    expect(elegirHerramienta("nota.docx", null)).toBeNull();
  });

  it("🔴 un HEIC NO se acepta, aunque su mime empiece por `image/`", () => {
    // Es la razón de que la lista de aceptados sea explícita en vez de un `mime.startsWith("image/")`:
    // `EXT_TO_MIME` mapea heic a `image/heic`, y ni el navegador lo pinta ni sharp lo lee sin
    // libheif. Devolver null aquí (→ 404 → icono) es la respuesta correcta, no un pendiente.
    expect(elegirHerramienta("foto.heic", "image/heic")).toBeNull();
    expect(elegirHerramienta("foto.heic", null)).toBeNull();
    expect(elegirHerramienta("x", "image/heif")).toBeNull();
    expect(elegirHerramienta("dibujo.svg", "image/svg+xml"), "svg tampoco: es texto y se rasteriza distinto").toBeNull();
  });

  it("lo demás no se sabe rasterizar", () => {
    for (const [n, m] of [["nota.docx", null], ["hoja.xlsx", null], ["comprimido.zip", null],
                          ["audio.mp3", "audio/mpeg"], ["video.mp4", "video/mp4"], ["", null]] as const) {
      expect(elegirHerramienta(n, m), `${n} / ${m}`).toBeNull();
    }
  });
});

describe("el tope de tamaño", () => {
  it("justo en el tope pasa; un byte por encima, no", () => {
    expect(superaElTope(TAMANO_MAXIMO_ENTRADA)).toBe(false);
    expect(superaElTope(TAMANO_MAXIMO_ENTRADA + 1)).toBe(true);
    expect(TAMANO_MAXIMO_ENTRADA, "25 MB").toBe(25 * 1024 * 1024);
  });

  it("acepta el tamaño como cadena, que es como lo devuelve pg para un bigint", () => {
    expect(superaElTope(String(TAMANO_MAXIMO_ENTRADA + 1))).toBe(true);
    expect(superaElTope("1024")).toBe(false);
  });

  it("un tamaño ausente o ilegible NO cuenta como excedido", () => {
    // Se prefiere intentarlo: lo que protege de verdad es que sharp tiene su propio límite de
    // píxeles y pdftoppm su timeout. Tratar "no lo sé" como "demasiado grande" quitaría miniaturas
    // a archivos perfectamente normales cuya fila no trae el tamaño.
    for (const v of [null, undefined, "", "no-es-un-numero", NaN]) {
      expect(superaElTope(v), String(v)).toBe(false);
    }
  });
});

describe("🔴 la clave de caché", () => {
  it("con sha256 es content-addressed y lleva el ancho", () => {
    expect(claveMiniatura(SHA)).toBe(`thumbs/${SHA}/320.jpg`);
    expect(claveMiniatura(SHA)).toContain(String(ANCHO_MINIATURA));
  });

  it("🔴 SIN sha256 NO hay clave: no se inventa una por id, por nombre ni por r2_key", () => {
    // `drive_files.sha256` es TEXT NULLABLE (migración 0025): hay filas antiguas sin hash. Componer
    // la clave con cualquier otra cosa rompe la promesa de "esta es la miniatura DE ESTE
    // CONTENIDO", y una clave equivocada sirve el documento de otra persona.
    expect(claveMiniatura(null)).toBeNull();
    expect(claveMiniatura(undefined)).toBeNull();
    expect(claveMiniatura("")).toBeNull();
    expect(claveMiniatura("   "), "ni un hash en blanco").toBeNull();
  });

  it("🔴 vive bajo `thumbs/` y JAMÁS bajo `objects/`", () => {
    // `objects/` son los originales. Que una derivada pudiera escribir ahí es lo que convertiría
    // una miniatura en una forma de pisar un documento (§0, §8).
    const k = claveMiniatura(SHA)!;
    expect(k.startsWith("thumbs/")).toBe(true);
    expect(k).not.toContain("objects/");
  });

  it("el mismo contenido en dos carpetas comparte una sola miniatura", () => {
    // Es el dedup que se hereda de ser content-addressed, y la razón de no meter el id en la clave.
    expect(claveMiniatura(SHA)).toBe(claveMiniatura(SHA));
  });
});

describe("`decidir` — todo lo que se resuelve antes de leer un byte", () => {
  it("un PDF normal: herramienta y clave", () => {
    const d = decidir(fila());
    expect(d).toEqual({ ok: true, herramienta: "pdftoppm", clave: `thumbs/${SHA}/320.jpg` });
  });

  it("un tipo no soportado se rechaza por el tipo, no por el tamaño", () => {
    expect(decidir(fila({ nombre: "nota.docx", mime: null }))).toEqual({ ok: false, motivo: "tipo_no_soportado" });
  });

  it("🔴 el tipo se mira ANTES que el tamaño", () => {
    // Un .docx de 30 MB tiene que decir "no sé hacer esto", no "es muy grande": el segundo mensaje
    // sugiere que con un archivo más pequeño funcionaría, y no es verdad.
    const d = decidir(fila({ nombre: "enorme.docx", mime: null, size_bytes: 30 * 1024 * 1024 }));
    expect((d as any).motivo).toBe("tipo_no_soportado");
  });

  it("un archivo soportado pero enorme se rechaza por el tamaño", () => {
    const d = decidir(fila({ size_bytes: TAMANO_MAXIMO_ENTRADA + 1 }));
    expect(d).toEqual({ ok: false, motivo: "demasiado_grande" });
  });

  it("🔴 un archivo sin sha256 SÍ se sirve, solo que sin clave que cachear", () => {
    const d = decidir(fila({ sha256: null }));
    expect(d.ok).toBe(true);
    expect((d as any).herramienta).toBe("pdftoppm");
    expect((d as any).clave, "sin clave: se genera al vuelo y no se guarda").toBeNull();
  });
});

describe("el semáforo", () => {
  it("no deja más de las permitidas a la vez, y a las demás las hace ESPERAR, no las rechaza", async () => {
    // Rasterizar es CPU y pdftoppm es un proceso por PDF. Sin tope, abrir dos fichas grandes a la
    // vez arrastra la API que atiende todo lo demás. Rechazar sería peor que esperar: quien abre
    // una ficha con 30 documentos quiere sus miniaturas.
    let simultaneas = 0;
    let pico = 0;
    const liberar: Array<() => void> = [];

    const tareas = Array.from({ length: MAX_GENERACIONES_SIMULTANEAS + 3 }, () =>
      conSemaforo(async () => {
        simultaneas++;
        pico = Math.max(pico, simultaneas);
        await new Promise<void>((r) => liberar.push(r));
        simultaneas--;
        return true;
      })
    );

    // Se deja que arranquen las que puedan y se comprueba el techo antes de soltar ninguna.
    await new Promise((r) => setTimeout(r, 10));
    expect(pico, "no puede haber más en curso que el tope").toBe(MAX_GENERACIONES_SIMULTANEAS);

    // Al soltarlas, las que esperaban entran: ninguna se perdió por el camino.
    while (liberar.length) liberar.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    while (liberar.length) liberar.shift()!();

    const hechas = await Promise.all(tareas);
    expect(hechas, "todas terminan; ninguna se rechaza").toHaveLength(MAX_GENERACIONES_SIMULTANEAS + 3);
    expect(hechas.every(Boolean)).toBe(true);
    expect(pico).toBe(MAX_GENERACIONES_SIMULTANEAS);
  });

  it("si la tarea lanza, el hueco se libera igual", async () => {
    // Sin el `finally`, cuatro errores seguidos dejarían el semáforo cerrado para siempre y las
    // miniaturas se quedarían colgadas sin que nada apareciera en los logs.
    await expect(conSemaforo(async () => { throw new Error("fallo simulado"); })).rejects.toThrow("fallo simulado");
    await expect(conSemaforo(async () => "sigue funcionando")).resolves.toBe("sigue funcionando");
  });
});
