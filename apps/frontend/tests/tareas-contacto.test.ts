import { describe, it, expect } from "vitest";

import {
  resolverVinculo, paraGuardar, oportunidadesElegibles,
  type ContactoLite, type OportunidadLite,
} from "@/lib/tareas-contacto";

// Fixtures sintéticos (§9.3): ni un nombre real sale de la base de negocio.
const ANA: ContactoLite = { id: "c-ana", nombre: "Ana Pérez" };
const BRUNO: ContactoLite = { id: "c-bruno", nombre: "Bruno Gil" };

const CASO_DE_ANA: OportunidadLite = {
  id: "o-1", nombre_caso: "Asilo de Ana", contacto_id: ANA.id, contacto_nombre: ANA.nombre,
};
const CASO_DE_BRUNO: OportunidadLite = {
  id: "o-2", nombre_caso: "Permiso de Bruno", contacto_id: BRUNO.id, contacto_nombre: BRUNO.nombre,
};
/** El caso que se olvida: `oportunidades.contacto_id` es NULLABLE. */
const CASO_HUERFANO: OportunidadLite = {
  id: "o-3", nombre_caso: "Caso viejo sin cliente", contacto_id: null, contacto_nombre: null,
};

describe("de qué cliente es una tarea", () => {
  it("sin nada puesto, el campo está vacío y se puede rellenar", () => {
    const v = resolverVinculo({});
    expect(v.contactoId).toBeNull();
    expect(v.motivo).toBe("libre");
    expect(v.editable).toBe(true);
    // Una explicación de lo que no pasa es ruido: solo se habla cuando algo está bloqueado.
    expect(v.explicacion).toBe("");
  });

  it("lo que la persona elige a mano manda, y sigue siendo editable", () => {
    const v = resolverVinculo({ contactoElegido: ANA });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.contactoNombre).toBe(ANA.nombre);
    expect(v.motivo).toBe("elegido");
    expect(v.editable).toBe(true);
  });

  it("abierto desde la ficha de un contacto, queda fijado y NO se puede cambiar", () => {
    const v = resolverVinculo({ contactoFijadoPorLaPantalla: ANA });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.motivo).toBe("fijado");
    expect(v.editable).toBe(false);
    expect(v.explicacion).not.toBe("");
  });

  it("el contacto fijado gana sobre el elegido a mano", () => {
    const v = resolverVinculo({ contactoFijadoPorLaPantalla: ANA, contactoElegido: BRUNO });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.motivo).toBe("fijado");
  });

  it("al elegir una oportunidad, el cliente lo pone ella y el campo se bloquea", () => {
    const v = resolverVinculo({ oportunidad: CASO_DE_ANA });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.contactoNombre).toBe(ANA.nombre);
    expect(v.motivo).toBe("derivado");
    expect(v.editable).toBe(false);
  });

  it("la oportunidad pisa al contacto que se había elegido a mano", () => {
    const v = resolverVinculo({ contactoElegido: BRUNO, oportunidad: CASO_DE_ANA });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.motivo).toBe("derivado");
  });

  /**
   * 🔴 EL CASO QUE PAGA ESTE MÓDULO. `oportunidades.contacto_id` es NULLABLE y hay casos viejos
   * sin cliente asignado. Si se diera por hecho que toda oportunidad trae uno, el campo quedaría
   * bloqueado Y vacío: sin forma de rellenarlo y sin que nada avise.
   */
  it("una oportunidad SIN cliente deja el campo libre, no bloqueado y vacío", () => {
    const v = resolverVinculo({ oportunidad: CASO_HUERFANO });
    expect(v.contactoId).toBeNull();
    expect(v.editable).toBe(true);
    expect(v.motivo).toBe("libre");
  });

  it("y con una oportunidad sin cliente, lo elegido a mano sigue valiendo", () => {
    const v = resolverVinculo({ contactoElegido: ANA, oportunidad: CASO_HUERFANO });
    expect(v.contactoId).toBe(ANA.id);
    expect(v.motivo).toBe("elegido");
    expect(v.editable).toBe(true);
  });

  /**
   * Quitar la oportunidad devuelve el campo a editable SIN perder lo que la persona había elegido
   * antes. Es la razón de que esto sea una función sobre el estado y no un `setForm` encadenado:
   * un `onChange` que sobrescribe el contacto al elegir oportunidad no sabe deshacerlo después.
   */
  it("quitar la oportunidad devuelve el contacto elegido, no lo borra", () => {
    const entrada = { contactoElegido: BRUNO, oportunidad: CASO_DE_ANA };
    expect(resolverVinculo(entrada).contactoId).toBe(ANA.id);

    const sinOportunidad = resolverVinculo({ ...entrada, oportunidad: null });
    expect(sinOportunidad.contactoId).toBe(BRUNO.id);
    expect(sinOportunidad.editable).toBe(true);
  });
});

/**
 * 🔴 EL CASO DE LA LISTA QUE AÚN NO HA LLEGADO. El modal pide las oportunidades al abrirse, así que
 * durante un instante hay un `oportunidad_id` puesto y ninguna oportunidad que consultar. Y al
 * abrir una tarea vieja, su oportunidad puede no venir en la lista.
 *
 * Sin distinguirlo, «esta oportunidad no tiene cliente» y «todavía no sé de quién es» se
 * confundirían: la primera deja elegir a mano, la segunda no puede.
 */
describe("hay una oportunidad puesta de la que no se sabe el cliente", () => {
  it("no se deja elegir a mano, y se sigue enseñando el nombre que ya había", () => {
    const v = resolverVinculo({ contactoElegido: ANA, oportunidadIdSinResolver: "o-desconocida" });
    expect(v.motivo).toBe("por_saber");
    expect(v.editable).toBe(false);
    // Pintar un hueco donde había un nombre parecería que la tarea perdió su cliente.
    expect(v.contactoNombre).toBe(ANA.nombre);
  });

  it("🔴 y al guardar se manda null: lo deriva el servidor de la oportunidad", () => {
    const cuerpo = paraGuardar({ contactoElegido: ANA, oportunidadIdSinResolver: "o-desconocida" });
    // Mandar el guardado sería mandar un dato que quizá ya no case con esa oportunidad, y saldría
    // un 400 al pulsar Guardar sin haber tocado nada del cliente.
    expect(cuerpo?.contacto_id).toBeNull();
    expect(cuerpo?.oportunidad_id).toBe("o-desconocida");
  });

  it("en cuanto la oportunidad se conoce, manda ella", () => {
    const v = resolverVinculo({
      contactoElegido: BRUNO, oportunidad: CASO_DE_ANA, oportunidadIdSinResolver: CASO_DE_ANA.id,
    });
    expect(v.motivo).toBe("derivado");
    expect(v.contactoId).toBe(ANA.id);
  });

  it("una oportunidad conocida SIN cliente no es lo mismo: ahí sí se elige a mano", () => {
    const v = resolverVinculo({ oportunidad: CASO_HUERFANO, oportunidadIdSinResolver: CASO_HUERFANO.id });
    expect(v.motivo).toBe("libre");
    expect(v.editable).toBe(true);
  });

  it("el contacto fijado por la pantalla sigue mandando aunque la oportunidad no se conozca", () => {
    const v = resolverVinculo({ contactoFijadoPorLaPantalla: ANA, oportunidadIdSinResolver: "o-desconocida" });
    expect(v.motivo).toBe("fijado");
    expect(paraGuardar({ contactoFijadoPorLaPantalla: ANA, oportunidadIdSinResolver: "o-desconocida" })?.contacto_id).toBe(ANA.id);
  });
});

describe("el conflicto entre el contacto fijado y el de la oportunidad", () => {
  it("se marca cuando la oportunidad es de otra persona", () => {
    const v = resolverVinculo({ contactoFijadoPorLaPantalla: ANA, oportunidad: CASO_DE_BRUNO });
    expect(v.conflicto).toBe(true);
    // El fijado sigue mandando, pero la pantalla no debe guardar esto.
    expect(v.contactoId).toBe(ANA.id);
  });

  it("no se marca cuando la oportunidad es del mismo, ni cuando no tiene cliente", () => {
    expect(resolverVinculo({ contactoFijadoPorLaPantalla: ANA, oportunidad: CASO_DE_ANA }).conflicto).toBe(false);
    expect(resolverVinculo({ contactoFijadoPorLaPantalla: ANA, oportunidad: CASO_HUERFANO }).conflicto).toBe(false);
  });

  it("con conflicto no hay nada que guardar: la pantalla no tiene que acordarse de mirarlo", () => {
    expect(paraGuardar({ contactoFijadoPorLaPantalla: ANA, oportunidad: CASO_DE_BRUNO })).toBeNull();
  });
});

describe("lo que se manda al servidor", () => {
  it("sale del mismo cálculo que decide el vínculo", () => {
    for (const entrada of [
      {},
      { contactoElegido: ANA },
      { contactoFijadoPorLaPantalla: ANA },
      { oportunidad: CASO_DE_ANA },
      { oportunidad: CASO_HUERFANO },
      { contactoElegido: BRUNO, oportunidad: CASO_DE_ANA },
    ]) {
      const cuerpo = paraGuardar(entrada);
      // La invariante: lo que se escribe es exactamente lo que la pantalla dice que es.
      expect(cuerpo?.contacto_id ?? null).toBe(resolverVinculo(entrada).contactoId);
    }
  });

  it("manda la oportunidad elegida, y null cuando no hay", () => {
    expect(paraGuardar({ oportunidad: CASO_DE_ANA })?.oportunidad_id).toBe(CASO_DE_ANA.id);
    expect(paraGuardar({ contactoElegido: ANA })?.oportunidad_id).toBeNull();
  });
});

describe("qué oportunidades se ofrecen", () => {
  const TODAS = [CASO_DE_ANA, CASO_DE_BRUNO, CASO_HUERFANO];

  it("con el contacto fijado, solo las suyas", () => {
    expect(oportunidadesElegibles(TODAS, ANA.id)).toEqual([CASO_DE_ANA]);
  });

  /**
   * La otra mitad del conflicto de arriba: si el desplegable no se acota, se puede elegir el caso
   * de otra persona desde la ficha de ésta. Aquí se fija que no aparece.
   */
  it("y desde la ficha de Ana no aparece el caso de Bruno", () => {
    expect(oportunidadesElegibles(TODAS, ANA.id)).not.toContain(CASO_DE_BRUNO);
  });

  it("una oportunidad sin cliente tampoco se ofrece cuando hay contacto fijado", () => {
    // No es suya: atarla dejaría la tarea de Ana colgando de un caso que no es de nadie.
    expect(oportunidadesElegibles(TODAS, ANA.id)).not.toContain(CASO_HUERFANO);
  });

  it("sin contacto fijado se ofrecen todas", () => {
    expect(oportunidadesElegibles(TODAS, null)).toEqual(TODAS);
    expect(oportunidadesElegibles(TODAS, undefined)).toEqual(TODAS);
  });
});
