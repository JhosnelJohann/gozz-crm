// ============================================================================================
// QUÉ SABE PINTAR EL VISOR — `src/lib/visor-archivo.ts`
//
// El proyecto tenía DOS visores con capacidades distintas: la modal extraía Word/Excel/PowerPoint
// en el servidor, y la página `/view` reproducía vídeo y audio y pintaba CSV. Fusionarlos es
// fusionar dos conjuntos de capacidades, y **la forma de estropearlo no da error**: basta con que
// una extensión caiga en la rama de «descargar» para que el chat deje de reproducir notas de voz
// sin que nada falle y sin que nadie se entere.
//
// 🔴 POR ESO ESTE FICHERO EXISTE. Es lo único de la tanda comprobable sin navegador, y es
// exactamente donde vive el riesgo.
//
// 🔴 Fixtures sintéticos (§9.3): nombres de archivo inventados.
// ============================================================================================

import { describe, expect, it } from "vitest";

import {
  MAX_FILAS_CSV, clasificarParaVisor, esOfimatica, filasDeCsv, necesitaTexto,
} from "@/lib/visor-archivo";

const modo = (nombre: string, mime: string | null = null, id?: string) =>
  clasificarParaVisor({ nombre, mime, id });

describe("lo que el navegador pinta solo — con id o sin él", () => {
  it("PDF", () => {
    expect(modo("contrato.pdf")).toBe("pdf");
    expect(modo("sin-extension", "application/pdf")).toBe("pdf");
  });

  it("imágenes", () => {
    for (const n of ["foto.jpg", "foto.jpeg", "captura.png", "animado.gif", "x.webp", "logo.svg", "mapa.bmp"]) {
      expect(modo(n), n).toBe("imagen");
    }
    expect(modo("x", "image/heic"), "un mime de imagen desconocido también entra").toBe("imagen");
  });

  it("🔴 VÍDEO — es una de las tres capacidades que solo tenía /view", () => {
    for (const n of ["clip.mp4", "grabacion.mov", "captura.webm"]) expect(modo(n), n).toBe("video");
    expect(modo("x", "video/quicktime")).toBe("video");
  });

  it("🔴 AUDIO — la otra. Es lo que se manda por chat como nota de voz", () => {
    for (const n of ["nota.mp3", "grabacion.wav", "audio.ogg", "voz.m4a"]) expect(modo(n), n).toBe("audio");
    expect(modo("x", "audio/mpeg")).toBe("audio");
  });

  it("🔴 CSV — la tercera", () => {
    expect(modo("export.csv")).toBe("csv");
    expect(modo("datos.tsv")).toBe("csv");
  });

  it("texto y código", () => {
    for (const n of ["notas.txt", "leeme.md", "salida.log", "datos.json", "config.yml", "script.py"]) {
      expect(modo(n), n).toBe("texto");
    }
    expect(modo("x", "text/plain")).toBe("texto");
  });

  it("🔴 el HTML se pinta como PÁGINA, no como código fuente (T4)", () => {
    // Estaba dentro de EXT_TEXTO, así que un `.html` enseñaba las etiquetas. Lo que se pidió el
    // 2026-08-24 es verlo: «me toca descargarlo y verlo en la computadora».
    expect(modo("reporte.html")).toBe("html");
    expect(modo("reporte.htm")).toBe("html");
    expect(modo("x", "text/html")).toBe("html");
  });

  it("el HTML gana a la rama de texto, y el resto de código sigue como estaba", () => {
    // El orden importa: si la comprobación de html fuera después, `texto` volvería a ganar.
    expect(modo("index.html", "text/plain")).toBe("html");
    expect(modo("estilos.css")).toBe("texto");
    expect(modo("app.tsx")).toBe("texto");
  });

  it("🔴 el `.webm` se resuelve como VÍDEO, no como audio", () => {
    // Es de los dos. Un `<video>` con solo pista de audio se oye igual; un `<audio>` con vídeo
    // dentro no se ve. Ante la duda, la opción que no pierde nada — que es lo que hacía /view.
    expect(modo("grabacion.webm")).toBe("video");
  });

  it("todos esos NO dependen del id: se pintan igual con o sin él", () => {
    for (const n of ["a.pdf", "a.jpg", "a.mp4", "a.mp3", "a.csv", "a.txt"]) {
      expect(modo(n, null, "un-id-de-drive"), n).toBe(modo(n, null, undefined));
    }
  });
});

describe("🔴 la ofimática, que es la única rama que depende del id", () => {
  const OFI = ["informe.docx", "informe.doc", "hoja.xlsx", "hoja.xls", "charla.pptx", "charla.ppt", "texto.rtf", "x.odt", "x.ods", "x.odp"];

  it("CON id se extrae en el servidor", () => {
    for (const n of OFI) expect(modo(n, null, "un-id-de-drive"), n).toBe("extraccion");
  });

  it("🔴 SIN id se ofrece descargar, no se finge una vista previa", () => {
    // La página /view lo intentaba con visores externos de Microsoft y Google, y no funcionaba:
    // esos servidores reciben un 401 porque las rutas exigen sesión. Lo único que conseguía era
    // mandarles la URL interna del CRM.
    for (const n of OFI) expect(modo(n), n).toBe("descarga");
  });

  it("también los reconoce por mime cuando no hay extensión", () => {
    expect(esOfimatica("x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(esOfimatica("x", "application/vnd.ms-excel")).toBe(true);
    expect(esOfimatica("x", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(true);
    expect(esOfimatica("foto.jpg", null)).toBe(false);
  });
});

describe("los bordes que aparecen en los datos de verdad", () => {
  it("🔴 mime NULO — es el caso corriente en lo importado de Pipedrive, Zoho y Bitrix", () => {
    // Mirando solo el mime, medio Drive caería en «descargar». Por eso se mira la extensión además.
    expect(modo("pasaporte.jpg", null)).toBe("imagen");
    expect(modo("i589.pdf", null)).toBe("pdf");
    expect(modo("nota.mp3", null)).toBe("audio");
  });

  it("la extensión en MAYÚSCULAS cuenta igual", () => {
    expect(modo("FOTO.JPG")).toBe("imagen");
    expect(modo("CONTRATO.PDF")).toBe("pdf");
    expect(modo("NOTA.MP3")).toBe("audio");
  });

  it("lo desconocido se descarga, con o sin id", () => {
    for (const n of ["comprimido.zip", "programa.exe", "sin-extension", ""]) {
      expect(modo(n), n).toBe("descarga");
      expect(modo(n, null, "un-id"), n + " con id").toBe("descarga");
    }
  });

  it("un mime raro no rompe nada", () => {
    expect(modo("x", "")).toBe("descarga");
    expect(modo("x", null)).toBe("descarga");
  });
});

describe("qué hace falta bajarse como texto", () => {
  it("el csv, el texto y el html", () => {
    expect(necesitaTexto("csv")).toBe(true);
    expect(necesitaTexto("texto")).toBe(true);
    // 🔴 El html se BAJA y se mete en el `srcdoc` de un iframe aislado. Si en vez de eso se
    // apuntara el iframe a la URL del archivo, el HTML correría en NUESTRO origen.
    expect(necesitaTexto("html")).toBe(true);
    for (const m of ["pdf", "imagen", "video", "audio", "extraccion", "descarga"] as const) {
      expect(necesitaTexto(m), m).toBe(false);
    }
  });
});

describe("el CSV como tabla", () => {
  it("parte en filas y columnas", () => {
    const { filas, recortado } = filasDeCsv("a,b,c\n1,2,3\n4,5,6");
    expect(filas).toEqual([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
    expect(recortado).toBe(false);
  });

  it("se salta las líneas vacías, incluida la del final", () => {
    expect(filasDeCsv("a,b\n1,2\n").filas).toHaveLength(2);
  });

  it("🔴 corta a 500 filas y AVISA de que cortó", () => {
    // Un CSV de exportación puede traer decenas de miles y pintarlas todas cuelga la pestaña. Pero
    // un recorte silencioso haría creer que el archivo tiene menos datos de los que tiene.
    const grande = Array.from({ length: MAX_FILAS_CSV + 20 }, (_, i) => `${i},x`).join("\n");
    const { filas, recortado } = filasDeCsv(grande);
    expect(filas).toHaveLength(MAX_FILAS_CSV);
    expect(recortado).toBe(true);
  });

  it("con un csv vacío no revienta", () => {
    expect(filasDeCsv("")).toEqual({ filas: [], recortado: false });
  });
});
