// ==============================================================================================
// QUÉ IMPIDE DAR DE ALTA UN CONTACTO — `src/lib/contacto-alta.ts`
//
// El alta se hace desde dos pantallas —el modal «Nuevo contacto» del listado y el mini-formulario
// del selector de contacto de «Nueva oportunidad»— y las dos llaman a la misma ruta. La regla es
// una, y hasta el 2026-08-31 estaba escrita dos veces: el modal exigía email Y teléfono, como el
// servidor, y el mini-formulario pedía «teléfono O email». Quien rellenaba solo el teléfono pasaba
// la comprobación de la pantalla y chocaba contra el 400. Esto prueba la regla ya unificada.
//
// 🔴 Y prueba lo que motivó la entrega: **sin fecha de nacimiento no falta nada**. Dejó de ser
// obligatoria porque el alta la pedía en un formulario que no tenía el campo, y porque 3.704 de
// los 3.811 contactos vivos no la tienen.
//
// ⚠️ QUÉ NO CUBRE ESTO, y hay que decirlo porque es justo la mitad visible del arreglo: que el
// campo de fecha **aparezca** en las dos pantallas, y que elegir un día en el calendario no cierre
// el desplegable del selector de contacto. Eso es DOM, y esta suite está en FASE 1 —solo lógica
// pura de `src/lib/`, sin `jsdom` (§9.1)—. Se comprueba mirando la pantalla, y está en
// `docs/PRUEBAS-STAGING-CONTACTOS.md`.
//
// 🔴 Fixtures sintéticos (§9.3): ni un nombre, ni un email, ni un teléfono reales.
// ==============================================================================================

import { describe, expect, it } from "vitest";

import {
  EMAIL_NO_VALIDO, FALTA_EMAIL, FALTA_NOMBRE, FALTA_TELEFONO,
  queFaltaParaElAlta, sePuedeDarDeAlta,
} from "@/lib/contacto-alta";

/** Lo mínimo que el servidor acepta. Todo inventado. */
const completo = { nombre: "Ana Sintetica", email: "ana@pruebas.invalid", telefono: "+13055550100" };

describe("con lo que hace falta, no falta nada", () => {
  it("los tres campos puestos", () => {
    expect(queFaltaParaElAlta(completo)).toBeNull();
    expect(sePuedeDarDeAlta(completo)).toBe(true);
  });

  it("🔴 SIN FECHA DE NACIMIENTO: no aparece en la regla, así que no puede impedir nada", () => {
    // El caso que motivó la entrega del 2026-08-31. La fecha ni siquiera entra en el tipo de
    // `queFaltaParaElAlta`: no es que se acepte vacía, es que no tiene voz aquí. Si alguien la
    // vuelve a hacer obligatoria, tendrá que añadirla — y esta prueba se lo dirá.
    expect(Object.keys(completo)).toEqual(["nombre", "email", "telefono"]);
    expect(queFaltaParaElAlta(completo)).toBeNull();
  });
});

describe("qué impide el alta, de uno en uno y en el orden del formulario", () => {
  it("el nombre, y con dos letras porque es lo que exige el servidor", () => {
    expect(queFaltaParaElAlta({ ...completo, nombre: "" })).toBe(FALTA_NOMBRE);
    expect(queFaltaParaElAlta({ ...completo, nombre: "   " })).toBe(FALTA_NOMBRE);
    // Con una sola letra la pantalla dejaría pulsar y el 400 llegaría con la lista cruda de zod,
    // que no es un mensaje para nadie.
    expect(queFaltaParaElAlta({ ...completo, nombre: "A" })).toBe(FALTA_NOMBRE);
    expect(queFaltaParaElAlta({ ...completo, nombre: "Ab" })).toBeNull();
  });

  it("🔴 el email hace falta SIEMPRE, aunque haya teléfono: era la regla que divergía", () => {
    expect(queFaltaParaElAlta({ ...completo, email: "" })).toBe(FALTA_EMAIL);
    expect(queFaltaParaElAlta({ ...completo, email: "   " })).toBe(FALTA_EMAIL);
  });

  it("un email en blanco es «falta»; uno con errata es «no vale»", () => {
    // Son dos cosas distintas para quien rellena: una es un olvido y la otra una errata.
    expect(queFaltaParaElAlta({ ...completo, email: "no-es-un-email" })).toBe(EMAIL_NO_VALIDO);
    expect(queFaltaParaElAlta({ ...completo, email: "sin@punto" })).toBe(EMAIL_NO_VALIDO);
    expect(queFaltaParaElAlta({ ...completo, email: "  ana@pruebas.invalid  " })).toBeNull();
  });

  it("🔴 el teléfono hace falta SIEMPRE, aunque haya email: la otra mitad de lo mismo", () => {
    expect(queFaltaParaElAlta({ ...completo, telefono: "" })).toBe(FALTA_TELEFONO);
    expect(queFaltaParaElAlta({ ...completo, telefono: "   " })).toBe(FALTA_TELEFONO);
  });

  it("se dice UN fallo, el primero, en el orden en que están en pantalla", () => {
    // Devolver los tres a la vez suena a formulario roto; de uno en uno se corrigen igual de
    // rápido y se lee mejor.
    expect(queFaltaParaElAlta({ nombre: "", email: "", telefono: "" })).toBe(FALTA_NOMBRE);
    expect(queFaltaParaElAlta({ ...completo, nombre: "Ana Sintetica", email: "", telefono: "" })).toBe(FALTA_EMAIL);
  });
});

describe("el botón y su motivo salen del mismo cálculo (§4.8)", () => {
  it("no se puede pulsar exactamente cuando hay un motivo que enseñar", () => {
    // Si el `disabled` y el `title` se calcularan aparte, acabarían discrepando: un botón apagado
    // sin motivo, o un motivo con el botón encendido.
    for (const d of [
      completo,
      { ...completo, nombre: "" },
      { ...completo, email: "" },
      { ...completo, email: "no-es-un-email" },
      { ...completo, telefono: "" },
    ]) {
      expect(sePuedeDarDeAlta(d), JSON.stringify(d)).toBe(queFaltaParaElAlta(d) === null);
    }
  });
});
