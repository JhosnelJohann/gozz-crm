// ============================================================================================
// EL GUARD DE LA BASE DESECHABLE — probado, no prometido.
//
// El resto de la suite descansa sobre la afirmación "las pruebas no pueden tocar otra base". Eso
// es una afirmación, y las afirmaciones se comprueban. Aquí se le pasan al guard las URLs que de
// verdad harían daño —la de staging del VPS, `crm_staging`, `postgres`— y se exige que las
// rechace. Si alguien relaja el guard, este fichero se pone rojo antes que ningún dato sufra.
//
// No toca la base: son funciones puras sobre cadenas de conexión.
// ============================================================================================

import { describe, expect, it } from "vitest";
import { NOMBRE_BASE_PRUEBAS, urlEnUso, verificarBasePruebas } from "./setup/test-db.js";

describe("guard de la base de pruebas", () => {
  it("acepta la base desechable en localhost", () => {
    expect(() => verificarBasePruebas(`postgres://u:p@localhost:5432/${NOMBRE_BASE_PRUEBAS}`)).not.toThrow();
    expect(() => verificarBasePruebas(`postgres://u:p@127.0.0.1:5432/${NOMBRE_BASE_PRUEBAS}`)).not.toThrow();
  });

  it("🔴 rechaza crm_staging y postgres, que son bases con datos reales", () => {
    expect(() => verificarBasePruebas("postgres://u:p@localhost:5432/crm_staging")).toThrow(/crm_staging/);
    expect(() => verificarBasePruebas("postgres://u:p@localhost:5432/postgres")).toThrow(/datos reales/);
  });

  it("🔴 rechaza cualquier host que no sea local, aunque el nombre de la base sea el correcto", () => {
    expect(() => verificarBasePruebas(`postgres://u:p@203.0.113.10:5432/${NOMBRE_BASE_PRUEBAS}`)).toThrow(/no es local/);
    expect(() => verificarBasePruebas(`postgres://u:p@db.interno.vps:5432/${NOMBRE_BASE_PRUEBAS}`)).toThrow(/no es local/);
  });

  it("rechaza cualquier otro nombre de base, aunque sea inofensivo", () => {
    // El guard es una lista blanca de UNO, no una lista negra: lo que no es exactamente la base
    // desechable, no pasa. Una lista negra se queda corta el día que aparece una base nueva.
    expect(() => verificarBasePruebas("postgres://u:p@localhost:5432/cualquier_otra")).toThrow(/tiene que ser exactamente/);
  });

  it("la suite está corriendo, de hecho, contra la base desechable", () => {
    expect(urlEnUso()).toContain(NOMBRE_BASE_PRUEBAS);
  });
});
