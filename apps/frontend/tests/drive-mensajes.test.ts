import { describe, it, expect } from "vitest";

import { mensajeDeError, codigosConocidos, type AccionDrive } from "@/lib/drive-mensajes";

const ACCIONES: AccionDrive[] = ["mover", "papelera"];

describe("los motivos del Drive", () => {
  /**
   * 🔴 La prueba que importa (§4.7). No comprueba textos concretos —cambiarán— sino que NUNCA
   * llegue a pantalla un identificador interno: ni el código tal cual, ni nada con pinta de
   * `esto_de_aqui`. Es el fallo que se cuela solo, escribiendo un `porQue[d.error] || d.error`.
   */
  for (const accion of ACCIONES) {
    it(`«${accion}» nunca devuelve un identificador interno`, () => {
      const casos = [...codigosConocidos(accion), "codigo_que_no_existe", "", "forbidden"];
      for (const codigo of casos) {
        const texto = mensajeDeError(accion, codigo);
        expect(texto).not.toBe(codigo);
        expect(texto).not.toMatch(/[a-z]_[a-z]/);
        expect(texto.length).toBeGreaterThan(10);
      }
    });

    it(`«${accion}» traduce todos los códigos que dice conocer`, () => {
      for (const codigo of codigosConocidos(accion)) {
        // Si alguno cayera al respaldo, la tabla estaría mintiendo sobre lo que cubre.
        expect(mensajeDeError(accion, codigo)).not.toBe(mensajeDeError(accion, "xxx"));
      }
    });
  }

  it("un código desconocido cae en el respaldo de SU acción, no en el de la otra", () => {
    expect(mensajeDeError("mover", "lo_que_sea")).toContain("mover");
    expect(mensajeDeError("papelera", "lo_que_sea")).toContain("papelera");
  });

  /**
   * El caso que obligó a partir la tabla en dos: el mismo código del servidor significa una cosa
   * al mover (el destino no admite) y otra al archivar (el origen no deja sacar). Si alguien
   * unifica los dos diccionarios «para simplificar», esto se pone rojo.
   */
  it("«forbidden_company_write» se explica distinto al mover que al archivar", () => {
    const alMover = mensajeDeError("mover", "forbidden_company_write");
    const alArchivar = mensajeDeError("papelera", "forbidden_company_write");
    expect(alMover).not.toBe(alArchivar);
    expect(alMover).toContain("dejar");
    expect(alArchivar).toContain("quitar");
  });

  it("aguanta lo que no es un texto sin romperse", () => {
    for (const basura of [undefined, null, 0, {}, []]) {
      expect(mensajeDeError("papelera", basura)).toBe(mensajeDeError("papelera", "xxx"));
    }
  });
});
