// ============================================================================================
// LA EDAD A PARTIR DE LA FECHA DE NACIMIENTO — `src/lib/utils.ts`
//
// `edadEnAnios` existe para no equivocarse en el unico dia del anio en que equivocarse se nota: el
// del cumpleanios. El backend serializa las columnas `date` como "YYYY-MM-DDT00:00:00.000Z", y en
// un huso detras de UTC —Caracas, ET— leer eso con `new Date()` devuelve el DIA ANTERIOR. Al
// formatear, eso pinta mal un dia; al calcular una edad, hace que **el dia del cumpleanios salga
// un anio de menos**.
//
// 🔴 EL RELOJ VA CONGELADO. Sin congelarlo, estas pruebas cambian de significado cada dia: "hoy
// menos 30 anios" no seria un caso fijo, y `1980-03-12` daria un numero distinto cada anio. Con el
// reloj quieto, el caso del cumpleanios se prueba DE VERDAD y no por casualidad del dia en que se
// corrio la suite.
//
// La fecha falsa se construye con componentes LOCALES —`new Date(2026, 7, 19, 12, 0, 0)`— y no con
// una cadena ISO: una cadena con `Z` depende del huso de la maquina y reintroduciria exactamente
// el fallo que esta funcion existe para evitar. Se congela a mediodia para que ningun redondeo de
// medianoche pueda mover el dia en un huso u otro.
//
// 🔴 Fixtures sinteticos (§9.3): aqui solo hay fechas inventadas. Ni un nombre, ni un dato real.
// ============================================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { edadEnAnios } from "@/lib/utils";

/** Miercoles 19 de agosto de 2026, mediodia LOCAL. Todo lo de abajo se lee contra esta fecha. */
const HOY = new Date(2026, 7, 19, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(HOY);
});

afterEach(() => {
  // Se restaura siempre: un reloj congelado que se escapa de su fichero es de los fallos que
  // aparecen en OTRA suite y cuestan una tarde encontrar.
  vi.useRealTimers();
});

describe("la cuenta normal", () => {
  it("una fecha corriente da los anios cumplidos", () => {
    // Nacido en marzo, hoy es agosto: el cumpleanios de este anio ya paso.
    expect(edadEnAnios("1980-03-12")).toBe(46);
  });

  it("si el cumpleanios de este anio AUN NO ha llegado, resta uno", () => {
    // Nacido en diciembre: en agosto todavia no ha cumplido.
    expect(edadEnAnios("1980-12-25")).toBe(45);
  });
});

describe("🔴 el dia del cumpleanios — el caso que justifica el cuidado con el huso", () => {
  it("el mismo dia del cumpleanios la edad YA ha subido", () => {
    // Nacido el 19 de agosto de 1996; hoy es 19 de agosto de 2026. Son 30, no 29.
    expect(edadEnAnios("1996-08-19")).toBe(30);
  });

  it("la vispera todavia no: sigue teniendo la edad de antes", () => {
    // Nacido el 20 de agosto: manana cumple 30, hoy tiene 29.
    expect(edadEnAnios("1996-08-20")).toBe(29);
  });

  it("y el dia siguiente al cumpleanios sigue siendo la nueva", () => {
    expect(edadEnAnios("1996-08-18")).toBe(30);
  });

  it("🔴 LA TRAMPA: new Date() sobre el mismo valor cae en la vispera, y edadEnAnios no se deja", () => {
    // Esto es exactamente lo que manda la API para una columna `date`.
    const comoLoManda = "1996-08-19T00:00:00.000Z";

    // Se demuestra que la trampa EXISTE antes de afirmar que se esquiva: en un huso detras de UTC
    // esto cae en el 18. Si la maquina que corre la suite estuviera en UTC o por delante no
    // caeria, asi que el assert se condiciona al huso en vez de fingir que siempre pasa.
    const ingenuo = new Date(comoLoManda);
    const husoDetrasDeUtc = HOY.getTimezoneOffset() > 0;
    if (husoDetrasDeUtc) {
      expect(ingenuo.getDate(), "en un huso detras de UTC esto cae en el dia 18").toBe(18);
    }

    // Y pase lo que pase con el huso, la funcion da 30: no lee la cadena como instante, extrae
    // YYYY-MM-DD y construye la fecha local.
    expect(edadEnAnios(comoLoManda)).toBe(30);
  });
});

describe("los bordes del calendario", () => {
  it("nacido un 29 de febrero: cuenta los anios cumplidos, sin saltar uno de mas", () => {
    // Hoy es agosto, asi que su cumpleanios (febrero) ya paso este anio: 26.
    expect(edadEnAnios("2000-02-29")).toBe(26);
  });

  it("un 29 de febrero que NO existe se rechaza, en vez de correrse al 1 de marzo", () => {
    // 2001 no fue bisiesto. `new Date(2001, 1, 29)` no falla: se desborda al 1 de marzo. Sin
    // comprobar que el dia que sale es el que entro, esto devolveria una edad inventada.
    expect(edadEnAnios("2001-02-29")).toBeNull();
  });
});

describe("nacido hoy, y el futuro", () => {
  it("un bebe nacido HOY es 0 anios, no null", () => {
    // 0 es una respuesta valida, no una senial de "no lo se": en este CRM hay bebes como
    // contactos (beneficiarios derivados). Lo que nunca se usa es el 0 como sustituto de null.
    expect(edadEnAnios("2026-08-19")).toBe(0);
  });

  it("manana es futuro: null, y NUNCA -1", () => {
    expect(edadEnAnios("2026-08-20")).toBeNull();
  });

  it("el anio que viene tambien", () => {
    expect(edadEnAnios("2027-08-19")).toBeNull();
  });
});

describe("lo que no se puede afirmar devuelve null", () => {
  it("sin valor", () => {
    expect(edadEnAnios(null)).toBeNull();
    expect(edadEnAnios(undefined)).toBeNull();
    expect(edadEnAnios("")).toBeNull();
  });

  it("el numero 0 tampoco es una fecha", () => {
    // Va aparte porque 0 es falsy: es el caso que un `if (!value)` acierta por accidente y que se
    // rompe en cuanto alguien lo cambia por `if (value === null)`.
    expect(edadEnAnios(0)).toBeNull();
  });

  it("una cadena que no es una fecha", () => {
    expect(edadEnAnios("no-es-fecha")).toBeNull();
  });

  it("meses y dias imposibles", () => {
    expect(edadEnAnios("2000-13-01"), "mes 13").toBeNull();
    expect(edadEnAnios("2000-00-01"), "mes 00").toBeNull();
    expect(edadEnAnios("2000-01-00"), "dia 00").toBeNull();
    expect(edadEnAnios("2000-01-32"), "dia 32").toBeNull();
  });

  it("🔴 un anio de dos cifras no se convierte en 19xx a la chita callando", () => {
    // `new Date(50, 0, 1)` NO es el anio 50: JavaScript mapea 0-99 a 1900-1999 y devuelve 1950.
    // Sin comprobar que el anio que sale es el que entro, "0050-01-01" daria 76 anios: un numero
    // perfectamente creible y perfectamente falso.
    expect(edadEnAnios("0050-01-01")).toBeNull();
    expect(edadEnAnios("0099-12-31")).toBeNull();
  });

  it("una edad fuera del rango humano", () => {
    // 526 anios. La fecha es valida; lo que no es creible es la persona.
    expect(edadEnAnios("1500-01-01")).toBeNull();
  });

  it("un objeto Date se rechaza, a proposito", () => {
    // Admitirlo obligaria a la conversion que esta funcion existe para evitar. La API manda
    // cadenas; si algun dia mandara otra cosa, mejor un null visible que una edad silenciosa.
    expect(edadEnAnios(new Date(1980, 2, 12))).toBeNull();
  });

  it("con espacios delante no parsea: la regex esta anclada al principio", () => {
    // Estricta a proposito. `fmtFechaSolo` si tiene un `new Date(value)` de reserva; aqui ese
    // camino esta prohibido, asi que lo que no encaja exacto se declara desconocido.
    expect(edadEnAnios(" 1980-03-12")).toBeNull();
  });
});

describe("el reloj esta congelado de verdad", () => {
  it("las llamadas ven el hoy fijado, no el de la maquina", () => {
    // Si esto fallara, las pruebas de arriba estarian midiendo el reloj de la maquina y no la
    // funcion: el aviso llega aqui, y no en forma de fallo intermitente a medianoche.
    expect(new Date().getFullYear()).toBe(2026);
    expect(new Date().getMonth()).toBe(7);
    expect(new Date().getDate()).toBe(19);
  });
});
