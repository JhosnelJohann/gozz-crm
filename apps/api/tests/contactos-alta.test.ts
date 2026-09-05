// ============================================================================================
// LO QUE SE EXIGE AL DAR DE ALTA — `src/lib/contactos-alta.ts`
//
// Se exigen **email y teléfono**, y solo al crear. La razón está en los datos: 670 de 3.811
// contactos vivos no tienen email, así que exigirlo también al editar dejaría sin poder guardar a
// cualquiera que abriese una de esas fichas a cambiar un teléfono.
//
// 🔴 POR ESO ESTO VIVE FUERA DE `ContactoFullSchema`: ese esquema lo comparten el POST y el PATCH,
// y endurecerlo allí sería exactamente la forma de romper la edición de esos 670.
//
// ════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 CAMBIO DE CONDUCTA (2026-08-31): LA FECHA DE NACIMIENTO YA NO ES OBLIGATORIA
// ════════════════════════════════════════════════════════════════════════════════════════════
// Lo fue entre el 19 y el 31 de agosto, y este fichero lo afirmaba. **Lo afirma al revés desde
// hoy, por decisión de Juan**, no porque una prueba estorbara (§9.4): el alta rápida desde una
// oportunidad pedía la fecha en un formulario que no tenía el campo, y de los 3.811 contactos
// vivos 3.704 no la tienen. Lo que se conserva —y se sigue probando aquí— es que **una fecha que
// viene tiene que valer**: opcional no es "no se comprueba".
//
// ⚠️ QUÉ NO CUBRE ESTE FICHERO, dicho para que no se lea como si lo cubriera: que el PATCH siga
// aceptando un contacto sin fecha **no se prueba aquí**. `ContactoFullSchema` es privado de
// `contactos-routes.ts` y exportarlo obligaría a importar el módulo de rutas entero —con multer y
// los integradores— dentro de la suite. Esa garantía se comprueba por HTTP en `rutas.test.ts` y
// está en el guion de staging. Lo que sí queda blindado aquí es que la regla del alta vive en un
// módulo aparte: mientras siga aquí, no puede afectar al PATCH.
//
// 🔴 Fixtures sintéticos (§9.3): solo fechas inventadas.
// ============================================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMAIL_NO_VALIDO, FALTA_EMAIL, FALTA_TELEFONO, FECHA_NACIMIENTO_NO_VALIDA,
  esEmailValido, esFechaDeNacimientoValida, hayTelefono, normalizarFechaNacimiento,
  queFaltaParaElAlta,
} from "../src/lib/contactos-alta.js";

/** Miércoles 19 de agosto de 2026, mediodía UTC. Congelado para que "futuro" sea un caso fijo. */
const HOY = new Date(Date.UTC(2026, 7, 19, 12, 0, 0));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOY); });
afterEach(() => { vi.useRealTimers(); });

describe("lo que se acepta", () => {
  it("una fecha normal en el formato que manda el selector", () => {
    expect(esFechaDeNacimientoValida("1980-03-12")).toBe(true);
    expect(esFechaDeNacimientoValida("1916-01-01")).toBe(true);
  });

  it("hoy mismo vale: un recién nacido es un contacto", () => {
    // En este CRM hay bebés como contactos (beneficiarios derivados). Rechazar "hoy" obligaría a
    // inventarse una fecha, que es peor que no tenerla.
    expect(esFechaDeNacimientoValida("2026-08-19")).toBe(true);
  });

  it("un 29 de febrero de un año bisiesto", () => {
    expect(esFechaDeNacimientoValida("2000-02-29")).toBe(true);
  });

  it("con espacios alrededor, que es lo que llega de un campo tecleado", () => {
    expect(esFechaDeNacimientoValida("  1980-03-12  ")).toBe(true);
  });
});

describe("lo que NO se acepta", () => {
  it("ausente, vacía o de otro tipo", () => {
    for (const v of [undefined, null, "", "   ", 0, 19800312, new Date(), {}, []]) {
      expect(esFechaDeNacimientoValida(v), JSON.stringify(v) ?? String(v)).toBe(false);
    }
  });

  it("otro formato de fecha, aunque sea legible para una persona", () => {
    // Se exige YYYY-MM-DD y nada más: aceptar varios formatos significa adivinar si 03-04 es marzo
    // o abril, y en una fecha de nacimiento adivinar no vale.
    for (const v of ["12/03/1980", "1980/03/12", "12-03-1980", "1980-3-12", "80-03-12"]) {
      expect(esFechaDeNacimientoValida(v), v).toBe(false);
    }
  });

  it("🔴 con hora pegada tampoco: es una fecha, no un instante", () => {
    // Es justo la forma en que la API serializa las columnas `date`. Si se aceptara aquí, el alta
    // dependería del huso de quien la manda.
    expect(esFechaDeNacimientoValida("1980-03-12T00:00:00.000Z")).toBe(false);
  });

  it("🔴 un día que NO existe en el calendario", () => {
    // `new Date(Date.UTC(2001, 1, 29))` no falla: se desborda al 1 de marzo. Sin comprobar que el
    // día que sale es el que entró, un día imposible entraría en la base convertido en otro.
    expect(esFechaDeNacimientoValida("2001-02-29"), "2001 no fue bisiesto").toBe(false);
    expect(esFechaDeNacimientoValida("1990-02-31")).toBe(false);
    expect(esFechaDeNacimientoValida("1990-13-01"), "mes 13").toBe(false);
    expect(esFechaDeNacimientoValida("1990-00-10"), "mes 00").toBe(false);
    expect(esFechaDeNacimientoValida("1990-01-00"), "día 00").toBe(false);
    expect(esFechaDeNacimientoValida("1990-04-31"), "abril tiene 30").toBe(false);
  });

  it("🔴 una fecha FUTURA", () => {
    // Al teclear el año es fácil dejarse un dígito, y un contacto que nace el año que viene no
    // canta hasta que alguien cotiza un seguro con esa edad.
    expect(esFechaDeNacimientoValida("2026-08-20"), "mañana").toBe(false);
    expect(esFechaDeNacimientoValida("2027-01-01"), "el año que viene").toBe(false);
  });
});

describe("el mensaje que ve quien lo intenta", () => {
  it("🔴 no nombra la columna ni ningún identificador interno (§4.7)", () => {
    // "el campo fecha_nacimiento no es válido" es el nombre de una columna: a quien da de alta un
    // cliente le suena a avería, no a una regla del negocio.
    expect(FECHA_NACIMIENTO_NO_VALIDA).not.toContain("fecha_nacimiento");
    expect(FECHA_NACIMIENTO_NO_VALIDA).not.toContain("contactos_cache");
    expect(FECHA_NACIMIENTO_NO_VALIDA).not.toMatch(/\bnull\b|\bcolumn|\bcampo `/i);
    expect(FECHA_NACIMIENTO_NO_VALIDA, "y dice de qué habla, en castellano").toContain("fecha de nacimiento");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
describe("🔴 la fecha tal como hay que guardarla", () => {
  // `""` no es `NULL` para Postgres: contra una columna `date` es un error 22007, o sea un 500
  // donde tenía que haber un alta correcta. Y un formulario dejado en blanco manda exactamente eso.
  it("lo vacío se convierte en «no hay fecha», no en cadena vacía", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(normalizarFechaNacimiento(v), JSON.stringify(v) ?? String(v)).toBeNull();
    }
  });

  it("una fecha se queda como está, sin los espacios de un campo tecleado", () => {
    expect(normalizarFechaNacimiento("1980-03-12")).toBe("1980-03-12");
    expect(normalizarFechaNacimiento("  1980-03-12  ")).toBe("1980-03-12");
  });

  it("🔴 NO valida: la forma con hora sale intacta, y tiene que salir así", () => {
    // Es como la API serializa una columna `date`, y es lo que la ficha del contacto devuelve en su
    // PATCH cuando alguien guarda sin tocar la fecha. Si esto se filtrara aquí, guardar cualquier
    // ficha que ya tenga fecha dejaría de funcionar.
    expect(normalizarFechaNacimiento("1980-03-12T00:00:00.000Z")).toBe("1980-03-12T00:00:00.000Z");
  });
});

// ============================================================================================
// EMAIL Y TELÉFONO AL ALTA (tanda C3, 2026-08-20)
//
// Misma asimetría y mismo motivo: **670 de 3.811 contactos vivos no tienen email**. Exigirlo
// también al editar dejaría sin poder guardar a cualquiera que abriese una de esas fichas.
// ============================================================================================

describe("qué falta para poder dar de alta", () => {
  const completo = { fecha_nacimiento: "1980-03-12", email: "ana@pruebas.invalid", telefono: "+13055550100" };

  it("con los tres, no falta nada", () => {
    expect(queFaltaParaElAlta(completo)).toBeNull();
  });

  it("🔴 SIN FECHA DE NACIMIENTO NO FALTA NADA — el caso que motivó la entrega del 31-ago", () => {
    // Es la afirmación que este fichero hacía al revés hasta hoy. Ausente, nula o en blanco: el
    // alta sale adelante. Quien la sepa, la escribe; a quien le falte, se le busca con el filtro
    // «sin fecha de nacimiento» del listado.
    for (const v of [undefined, null, "", "   "]) {
      expect(queFaltaParaElAlta({ ...completo, fecha_nacimiento: v }), JSON.stringify(v) ?? String(v)).toBeNull();
    }
  });

  it("🔴 pero una fecha que SÍ viene tiene que valer: opcional no es «no se comprueba»", () => {
    // Un 31 de febrero no lo rechaza JavaScript —se desborda al 3 de marzo—, y un año con un
    // dígito de más no canta hasta que alguien cotiza un seguro con esa edad.
    expect(queFaltaParaElAlta({ ...completo, fecha_nacimiento: "1990-02-31" })).toBe(FECHA_NACIMIENTO_NO_VALIDA);
    expect(queFaltaParaElAlta({ ...completo, fecha_nacimiento: "2027-01-01" })).toBe(FECHA_NACIMIENTO_NO_VALIDA);
    expect(queFaltaParaElAlta({ ...completo, fecha_nacimiento: "12/03/1980" })).toBe(FECHA_NACIMIENTO_NO_VALIDA);
  });

  it("una fecha mal escrita se dice ANTES que un email que falta", () => {
    // El orden es el del formulario, y la fecha va antes que el email en las dos pantallas.
    expect(queFaltaParaElAlta({ fecha_nacimiento: "1990-02-31" })).toBe(FECHA_NACIMIENTO_NO_VALIDA);
  });

  it("el orden es el del formulario: se dice UN fallo, el primero", () => {
    // Devolver los tres a la vez suena a formulario roto; de uno en uno se corrigen igual de
    // rápido y se lee mejor.
    expect(queFaltaParaElAlta({})).toBe(FALTA_EMAIL);
    expect(queFaltaParaElAlta({ ...completo, fecha_nacimiento: undefined, email: undefined })).toBe(FALTA_EMAIL);
    expect(queFaltaParaElAlta({ ...completo, email: undefined })).toBe(FALTA_EMAIL);
    expect(queFaltaParaElAlta({ ...completo, telefono: "" })).toBe(FALTA_TELEFONO);
  });

  it("un email en blanco es «falta», no «no vale»", () => {
    // Son dos cosas distintas para quien rellena: una es un olvido y la otra una errata.
    expect(queFaltaParaElAlta({ ...completo, email: "   " })).toBe(FALTA_EMAIL);
    expect(queFaltaParaElAlta({ ...completo, email: "no-es-un-email" })).toBe(EMAIL_NO_VALIDO);
  });

  it("🔴 los mensajes no nombran ninguna columna (§4.7)", () => {
    for (const m of [FALTA_EMAIL, EMAIL_NO_VALIDO, FALTA_TELEFONO]) {
      expect(m).not.toContain("contactos_cache");
      expect(m).not.toMatch(/\bcampo `|\bcolumn/i);
    }
  });
});

describe("qué cuenta como email", () => {
  it("las formas corrientes valen, incluidas las que un patrón estricto rechazaría", () => {
    // No se valida contra un patrón exhaustivo: los que existen dan falsos negativos con
    // direcciones legítimas, y rechazar el correo real de un cliente bloquea el alta sin rodeo.
    // Una errata, en cambio, se ve al primer envío que rebota.
    for (const v of ["ana@pruebas.invalid", "a.b+c@sub.dominio.com", "  ana@pruebas.invalid  ", "ñ@dominio.es"]) {
      expect(esEmailValido(v), v).toBe(true);
    }
  });

  it("lo que no tiene forma de email, no", () => {
    for (const v of ["", "   ", "no-es-un-email", "sin@punto", "@sinlocal.com", "dos @ arrobas@x.com", null, 42]) {
      expect(esEmailValido(v as any), String(v)).toBe(false);
    }
  });
});

describe("qué cuenta como teléfono", () => {
  it("cualquier cosa que no esté en blanco: el formato lo normaliza la pantalla", () => {
    expect(hayTelefono("+13055550100")).toBe(true);
    expect(hayTelefono("305 555 0100")).toBe(true);
    expect(hayTelefono("")).toBe(false);
    expect(hayTelefono("   ")).toBe(false);
    expect(hayTelefono(null)).toBe(false);
  });
});
