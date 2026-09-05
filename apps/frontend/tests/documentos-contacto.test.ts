// ============================================================================================
// EL RECORRIDO DE DOCUMENTOS DE UN CONTACTO — `src/lib/documentos-contacto.ts`
//
// `aplanarDocumentos` existe para que la lista, la galeria y las flechas del visor no puedan
// discrepar sobre QUE archivos hay y en QUE ORDEN. Si cada vista calculara el suyo, el «3 / 47»
// empezaria a mentir **sin que nada falle**: seguiria contando hasta 47 y seguiria avanzando, solo
// que a otro archivo del que el usuario cree estar viendo.
//
// Por eso la prueba que mas importa aqui no es que los indices sean correlativos —eso es
// aritmetica— sino que `grupos[i].archivos[j]` y `planos[k]` sean **el mismo objeto**. Mientras lo
// sean, la discrepancia es imposible por construccion y no por disciplina.
//
// La otra mitad es la tolerancia: la pestania fusiona TRES fuentes (Pipedrive, Zoho y Bitrix), asi
// que basta con que una devuelva algo raro para que la pestania entera se caiga si esto no aguanta.
//
// 🔴 Fixtures sinteticos (§9.3): nombres de archivo y de carpeta inventados. Ni un dato real.
// ============================================================================================

import { describe, expect, it } from "vitest";

import { aplanarDocumentos } from "@/lib/documentos-contacto";

/** Un archivo de mentira con la forma que manda la API. */
const archivo = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  mime: "application/pdf",
  size_bytes: 1024,
  created_at: "2026-01-15T10:00:00.000Z",
  ...extra,
});

/** Una carpeta de mentira. */
const carpeta = (folder_id: string, folder_nombre: string, files: unknown[]) => ({
  folder_id,
  folder_nombre,
  files,
});

/** Dos carpetas con dos y tres archivos: lo justo para ver que los indices cruzan. */
const DOS_CARPETAS = [
  carpeta("f-1", "Carpeta uno", [archivo("a-1", "uno.pdf"), archivo("a-2", "dos.pdf")]),
  carpeta("f-2", "Carpeta dos", [
    archivo("a-3", "tres.pdf"),
    archivo("a-4", "cuatro.pdf"),
    archivo("a-5", "cinco.pdf"),
  ]),
];

describe("el recorrido", () => {
  it("recoge todos los archivos de todas las carpetas", () => {
    const { grupos, planos } = aplanarDocumentos(DOS_CARPETAS);
    expect(grupos).toHaveLength(2);
    expect(planos).toHaveLength(5);
  });

  it("🔴 los indices son CONTINUOS cruzando de una carpeta a la siguiente", () => {
    // Es lo que hace que el «3 / 47» cuente el contacto entero y no una carpeta: el primer
    // archivo de la segunda carpeta tiene que ser el 2, no volver a empezar en 0.
    const { grupos, planos } = aplanarDocumentos(DOS_CARPETAS);

    expect(planos.map((d) => d.indice)).toEqual([0, 1, 2, 3, 4]);
    expect(grupos[0].archivos.map((d) => d.indice)).toEqual([0, 1]);
    expect(grupos[1].archivos.map((d) => d.indice), "la segunda carpeta CONTINUA, no reinicia").toEqual([2, 3, 4]);
  });

  it("el indice de cada elemento es su posicion real en `planos`", () => {
    // Si esto se desalineara, pulsar una tarjeta abriria otro archivo.
    const { planos } = aplanarDocumentos(DOS_CARPETAS);
    planos.forEach((doc, i) => expect(doc.indice).toBe(i));
  });

  it("el orden es el de entrada: no se reordena nada", () => {
    // La API ya ordena carpetas y archivos por nombre. Reordenar aqui seria una segunda opinion
    // sobre el orden, que es justo lo que este modulo existe para no tener.
    const { planos } = aplanarDocumentos(DOS_CARPETAS);
    expect(planos.map((d) => d.file.nombre)).toEqual(["uno.pdf", "dos.pdf", "tres.pdf", "cuatro.pdf", "cinco.pdf"]);
    expect(planos.map((d) => d.folderNombre)).toEqual([
      "Carpeta uno", "Carpeta uno", "Carpeta dos", "Carpeta dos", "Carpeta dos",
    ]);
  });

  it("🔴 grupos y planos comparten LA MISMA REFERENCIA, no copias equivalentes", () => {
    // ESTA es la prueba que sostiene todo el modulo. Con `toBe` (identidad), no con `toEqual`
    // (equivalencia): dos objetos iguales hoy pueden dejar de serlo maniana, y entonces la lista y
    // la galeria empezarian a hablar de cosas distintas sin que ningun test se entere.
    const { grupos, planos } = aplanarDocumentos(DOS_CARPETAS);

    expect(grupos[0].archivos[0]).toBe(planos[0]);
    expect(grupos[0].archivos[1]).toBe(planos[1]);
    expect(grupos[1].archivos[0]).toBe(planos[2]);
    expect(grupos[1].archivos[2]).toBe(planos[4]);

    // Y el `file` de dentro tambien es el mismo objeto, no una reconstruccion.
    expect(grupos[1].archivos[1].file).toBe(planos[3].file);
  });
});

describe("las carpetas vacias", () => {
  it("no aparecen en `grupos` y NO consumen indice", () => {
    // Es el mismo filtro `files.length > 0` que la lista aplicaba antes de existir este modulo.
    // Si una carpeta vacia contara, las flechas se pararian en huecos invisibles.
    const conVacia = [
      carpeta("f-1", "Con archivos", [archivo("a-1", "uno.pdf")]),
      carpeta("f-vacia", "Vacia", []),
      carpeta("f-2", "Con mas", [archivo("a-2", "dos.pdf")]),
    ];
    const { grupos, planos } = aplanarDocumentos(conVacia);

    expect(grupos.map((g) => g.folderId), "la vacia no sale").toEqual(["f-1", "f-2"]);
    expect(planos.map((d) => d.indice)).toEqual([0, 1]);
    expect(planos[1].file.id, "el indice 1 es el archivo siguiente, no un hueco").toBe("a-2");
  });

  it("si TODAS estan vacias, el resultado esta vacio pero es valido", () => {
    const { grupos, planos } = aplanarDocumentos([carpeta("f-1", "Vacia", []), carpeta("f-2", "Tambien", [])]);
    expect(grupos).toEqual([]);
    expect(planos).toEqual([]);
  });
});

describe("lo que llega mal no revienta la pestania", () => {
  // Tres fuentes distintas alimentan esto. Que una devuelva basura no puede dejar al usuario sin
  // pestania: se devuelve vacio y se sigue.
  const vacio = { grupos: [], planos: [], vacios: [] };

  it("undefined, null y una lista vacia", () => {
    expect(aplanarDocumentos(undefined)).toEqual(vacio);
    expect(aplanarDocumentos(null)).toEqual(vacio);
    expect(aplanarDocumentos([])).toEqual(vacio);
  });

  it("algo que ni siquiera es una lista", () => {
    expect(aplanarDocumentos({} as any)).toEqual(vacio);
    expect(aplanarDocumentos("no soy una lista" as any)).toEqual(vacio);
    expect(aplanarDocumentos(42 as any)).toEqual(vacio);
  });

  it("una carpeta sin `files`, con `files: null` o con `files` que no es lista", () => {
    const raras = [
      { folder_id: "f-1", folder_nombre: "Sin files" },
      { folder_id: "f-2", folder_nombre: "Files nulo", files: null },
      { folder_id: "f-3", folder_nombre: "Files objeto", files: {} },
    ];
    const r = aplanarDocumentos(raras);
    // Nada que recorrer: ni grupo ni archivo.
    expect(r.grupos).toEqual([]);
    expect(r.planos).toEqual([]);
    // Pero desde la T3 SI se sabe que esas tres carpetas llegaron y estaban vacias. Antes se
    // perdian sin dejar rastro, y una negociacion sin documentos tiene que poder verse.
    expect(r.vacios.map((v) => v.folderId)).toEqual(["f-1", "f-2", "f-3"]);
  });

  it("un null dentro de la lista de carpetas se salta, y las demas se procesan", () => {
    // Lo importante no es que no lance: es que la carpeta buena que viene DESPUES del null se
    // siga procesando. Un `try/catch` alrededor de todo pasaria el "no lanza" y perderia esto.
    const conNull = [null, carpeta("f-1", "Buena", [archivo("a-1", "uno.pdf")]), undefined];
    const { grupos, planos } = aplanarDocumentos(conNull);
    expect(grupos).toHaveLength(1);
    expect(planos).toHaveLength(1);
    expect(planos[0].file.id).toBe("a-1");
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 BASURA DENTRO DE `files` — el defecto que destapo esta suite el 2026-08-19, ya cerrado
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Eran CUATRO formas, y las dos peores no eran las que lanzaban:
  //
  //     [null, {…}]       TypeError leyendo `.id`     — ruidoso, se ve
  //     [undefined, {…}]  TypeError, misma causa      — ruidoso, se ve
  //     ["nope"]          NO lanzaba: `id: undefined` — silencioso, MIENTE
  //     [7]               NO lanzaba: idem            — silencioso, MIENTE
  //
  // Un elemento con `id: undefined` pinta una tarjeta con `key={undefined}` y un enlace a
  // `/api/drive/files/undefined/download`. No falla: se descubre cuando alguien pulsa.
  //
  // Los cuatro casos comprueban DOS cosas, y la segunda es la que vale: que no lance, **y que el
  // archivo bueno de al lado siga saliendo**. Un `try/catch` alrededor de todo pasaria el "no
  // lanza" y se comeria los archivos buenos sin que ninguna prueba se enterara.
  const basura: Array<[string, unknown]> = [
    ["un null", null],
    ["un undefined", undefined],
    ["una cadena", "nope"],
    ["un numero", 7],
  ];

  for (const [comoSeLlama, malo] of basura) {
    it(`🔴 ${comoSeLlama} dentro de \`files\` se salta, y el archivo bueno de al lado SI sale`, () => {
      const entrada = [carpeta("f-1", "Mezclada", [malo, archivo("a-1", "bueno.pdf")])];

      let resultado!: ReturnType<typeof aplanarDocumentos>;
      expect(() => { resultado = aplanarDocumentos(entrada); }, "no puede lanzar").not.toThrow();

      // Y sobre todo: no se ha perdido el archivo bueno, ni se ha colado el malo.
      expect(resultado.planos, "solo el bueno").toHaveLength(1);
      expect(resultado.planos[0].file.id).toBe("a-1");
      expect(resultado.planos[0].file.nombre).toBe("bueno.pdf");
      expect(resultado.planos[0].indice, "el indice no deja hueco por el descartado").toBe(0);
      expect(resultado.grupos[0].archivos).toHaveLength(1);
      expect(resultado.grupos[0].archivos[0]).toBe(resultado.planos[0]);
    });
  }

  it("🔴 un objeto SIN `id` tampoco pasa: es la forma que no lanzaba y mentia", () => {
    // Es el caso que motiva comprobar `id` y no solo que la entrada sea un objeto. Sin esta
    // guarda saldria una tarjeta con `key={undefined}` y un enlace de descarga roto.
    const entrada = [carpeta("f-1", "Mezclada", [{ nombre: "sin-id.pdf" }, archivo("a-1", "bueno.pdf")])];
    const { planos } = aplanarDocumentos(entrada);

    expect(planos).toHaveLength(1);
    expect(planos[0].file.id).toBe("a-1");
  });

  it("si TODAS las entradas de una carpeta son basura, la carpeta queda vacia y no aparece", () => {
    // La carpeta se descarta igual que una que llegara sin archivos: no puede quedar un grupo
    // vacio en la lista ni consumir un indice en el recorrido.
    const { grupos, planos } = aplanarDocumentos([carpeta("f-1", "Toda mala", [null, "x", 7])]);
    expect(grupos).toEqual([]);
    expect(planos).toEqual([]);
  });
});

describe("los campos que la API puede no mandar", () => {
  it("`mime` y `size_bytes` ausentes quedan en null, no en undefined", () => {
    // `undefined` desaparece al serializar y rompe comparaciones; `null` es un "no hay" explicito.
    const sinCampos = [carpeta("f-1", "Carpeta", [{ id: "a-1", nombre: "x.bin", created_at: "2026-01-15T10:00:00.000Z" }])];
    const { planos } = aplanarDocumentos(sinCampos);

    expect(planos[0].file.mime).toBeNull();
    expect(planos[0].file.size_bytes).toBeNull();
  });

  it("el `folder_id` de la carpeta se propaga al archivo", () => {
    // El archivo que manda la API no trae su carpeta; la necesita el visor para saber cual
    // desplegar al navegar hasta el.
    const { planos } = aplanarDocumentos(DOS_CARPETAS);
    expect(planos[0].file.folder_id).toBe("f-1");
    expect(planos[4].file.folder_id).toBe("f-2");
    expect(planos[4].folderId).toBe("f-2");
  });

  it("una carpeta sin nombre ni id no rompe: quedan en cadena vacia", () => {
    const { grupos } = aplanarDocumentos([{ files: [archivo("a-1", "uno.pdf")] }]);
    expect(grupos[0].folderId).toBe("");
    expect(grupos[0].folderNombre).toBe("");
  });
});
