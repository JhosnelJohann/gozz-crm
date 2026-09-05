// ============================================================================================
// SEÑALES DEL FILTRO "DUPLICADOS POR REVISAR" — `src/lib/contactos-dedup.ts`
//
// Este filtro es la herramienta con la que un equipo HUMANO decide qué contactos se fusionan, y
// fusionar destruye el expediente del perdedor si la decisión es mala. Lo que se prueba aquí no es
// una consulta bonita: es que la lista no le entregue a esa persona ruido ni señales que no
// distinguen nada.
//
// 🔴 Ninguna de estas pruebas toca datos de negocio. Todos los contactos son sintéticos y viven en
// la base desechable. Y ninguna limpia marcas `revision_dedup`: hay un caso que comprueba
// justamente lo contrario, que ocultar un grupo NO lo borra (§0).
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import {
  DOMINIOS_PROPIOS,
  UMBRAL_SUPERSET,
  UMBRAL_TOKEN,
  analizarParecidoNombres,
  esClaveDeDominioPropio,
  normalizarNombre,
  sqlDuplicadosRevisables,
} from "../src/lib/contactos-dedup.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { crearContacto } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
  // Sin pg_trgm la señal de D5 no existe. Que falle aquí y no a mitad de un caso.
  const [{ hay }] = await query<any>(
    `SELECT count(*)::int AS hay FROM pg_extension WHERE extname = 'pg_trgm'`
  );
  expect(hay, "la base de pruebas necesita pg_trgm (la crea el global-setup)").toBe(1);
});

/**
 * Ejecuta EL MISMO WHERE que usa la pantalla, construido por la misma función.
 * Devuelve las filas y el total contado con ese WHERE, que es lo que el endpoint hace en paralelo.
 */
async function loQueVeLaPantalla(): Promise<{ ids: string[]; total: number }> {
  const params: any[] = [];
  const addP = (v: any) => { params.push(v); return `$${params.length}`; };
  const where = ["COALESCE(archivado, false) = false", ...sqlDuplicadosRevisables(addP)].join(" AND ");
  const [filas, conteo] = await Promise.all([
    query<any>(`SELECT id FROM gozz.contactos_cache WHERE ${where}`, params),
    query<any>(`SELECT count(*)::int AS total FROM gozz.contactos_cache WHERE ${where}`, params),
  ]);
  return { ids: filas.map((f) => f.id), total: conteo[0].total };
}

const sinHijos = { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 };

describe("D2 · el filtro no enseña lo que no se puede fusionar", () => {
  it("un grupo con pareja viva SÍ sale; uno cuya pareja quedó archivada NO sale", async () => {
    const s = Date.now().toString(36);

    // Grupo accionable: los dos vivos y marcados. Es lo único con lo que un humano puede hacer algo,
    // porque fusionar exige EXACTAMENTE 2.
    const grupoVivo = `email:pareja-viva-${s}@ejemplo.invalid`;
    const vivoA = await crearContacto({ nombre: `Vivo A ${s}`, email: `viva-a-${s}@ejemplo.invalid`, telefono: "+1500000001", grupo: grupoVivo, hijos: sinHijos });
    const vivoB = await crearContacto({ nombre: `Vivo B ${s}`, email: `viva-b-${s}@ejemplo.invalid`, telefono: "+1500000002", grupo: grupoVivo, hijos: sinHijos });

    // Grupo huérfano: reproduce lo que pasó de verdad en staging. La dedup marcó a los dos y
    // después Leads→Clientes archivó a uno; la marca se quedó puesta en el superviviente, que ya no
    // tiene con quién compararse. Eran 43 de las 73 filas que listaba la pantalla.
    const grupoHuerfano = `email:pareja-muerta-${s}@ejemplo.invalid`;
    const superviviente = await crearContacto({ nombre: `Superviviente ${s}`, email: `sup-${s}@ejemplo.invalid`, telefono: "+1500000003", grupo: grupoHuerfano, hijos: sinHijos });
    const archivado = await crearContacto({ nombre: `Archivado ${s}`, email: `arch-${s}@ejemplo.invalid`, telefono: "+1500000004", grupo: grupoHuerfano, hijos: sinHijos });
    await query(
      `UPDATE gozz.contactos_cache
          SET archivado = true, archivado_motivo = 'lead_sin_oportunidad:PRUEBA'
        WHERE id = $1`,
      [archivado]
    );

    const { ids } = await loQueVeLaPantalla();

    expect(ids, "los dos con pareja viva salen").toEqual(expect.arrayContaining([vivoA, vivoB]));
    expect(ids, "el superviviente sin pareja NO sale: no se puede fusionar con nadie").not.toContain(superviviente);
    expect(ids, "el archivado tampoco, obviamente").not.toContain(archivado);

    // 🔴 §0: se OCULTA, no se limpia. La marca sigue exactamente donde estaba.
    const [m] = await query<any>(
      `SELECT revision_dedup, revision_dedup_grupo FROM gozz.contactos_cache WHERE id = $1`,
      [superviviente]
    );
    expect(m.revision_dedup).toBe(true);
    expect(m.revision_dedup_grupo).toBe(grupoHuerfano);
  });

  it("el total de la cabecera cuadra con las filas devueltas", async () => {
    // Si el contador siguiera contando lo viejo, cambiaríamos un problema por otro peor: una lista
    // que dice 73 y enseña 30. El endpoint construye las dos consultas con el MISMO `where`; aquí
    // se comprueba que ese where produce ambos números iguales.
    const { ids, total } = await loQueVeLaPantalla();
    expect(total).toBe(ids.length);
  });
});

describe("D4 · un correo de la propia agencia no empareja a nadie", () => {
  it("un grupo cuya clave es un email de dominio propio NO sale, y sus marcas siguen intactas", async () => {
    const s = Date.now().toString(36);
    // Reproduce el caso real: dos clientes SIN NINGUNA RELACIÓN a los que alguien les puso el email
    // de facturación de la agencia. Fusionarlos mezcla dos expedientes; es el defecto más peligroso
    // de los cuatro, porque el grupo parece perfectamente accionable.
    const grupoPropio = `email:facturacion@${DOMINIOS_PROPIOS[0]}`;
    const clienteUno = await crearContacto({ nombre: `Cliente Uno ${s}`, email: `uno-${s}@ejemplo.invalid`, telefono: "+1500000010", grupo: grupoPropio, hijos: sinHijos });
    const clienteDos = await crearContacto({ nombre: `Cliente Dos ${s}`, email: `dos-${s}@ejemplo.invalid`, telefono: "+1500000011", grupo: grupoPropio, hijos: sinHijos });

    const { ids } = await loQueVeLaPantalla();
    expect(ids).not.toContain(clienteUno);
    expect(ids).not.toContain(clienteDos);

    // 🔴 §0 otra vez: ocultar no es limpiar.
    const filas = await query<any>(
      `SELECT revision_dedup, revision_dedup_grupo FROM gozz.contactos_cache WHERE id = ANY($1::uuid[])`,
      [[clienteUno, clienteDos]]
    );
    expect(filas).toHaveLength(2);
    for (const f of filas) {
      expect(f.revision_dedup).toBe(true);
      expect(f.revision_dedup_grupo).toBe(grupoPropio);
    }
  });

  it("los tres dominios propios se reconocen, y uno ajeno que se les parece NO", async () => {
    for (const d of DOMINIOS_PROPIOS) {
      expect(esClaveDeDominioPropio(`email:cualquiera@${d}`), d).toBe(true);
      expect(esClaveDeDominioPropio(`email:MAYUSCULAS@${d.toUpperCase()}`), d).toBe(true);
    }
    // Comparación de dominio EXACTO, no "contiene": un dominio ajeno que termine parecido no cuela.
    expect(esClaveDeDominioPropio("email:alguien@no-gozz-agencia.com")).toBe(false);
    expect(esClaveDeDominioPropio("email:alguien@gmail.com")).toBe(false);
    // Y agrupar por teléfono no se toca: solo se descartan las claves de email.
    expect(esClaveDeDominioPropio("tel:3055550123")).toBe(false);
  });
});

describe("D5 · la señal de parecido distingue duplicado de familia", () => {
  // 🔴 Nombres INVENTADOS con la misma FORMA que los reales medidos en staging (§9.3): ni un
  // nombre sale de la base de negocio.
  //
  // Por qué no basta un umbral de `similarity()`, medido sobre estas mismas formas:
  //     FAMILIA  hermanos con dos apellidos ..... 0.7586
  //     DUPLICADO segundo nombre largo .......... 0.5122
  // Las clases SE SOLAPAN, así que cualquier corte único deja mal clasificada una de las dos. Lo
  // que sí separa es mirar los nombres como conjuntos de palabras: ¿tiene CADA ficha una palabra
  // propia que la otra no tiene? Ahí la señal es limpia — dos nombres de pila distintos dan
  // `similarity()` 0.0000.

  it("DUPLICADO · mismo nombre y apellido, uno con segundo nombre y el otro sin él", async () => {
    const r = await analizarParecidoNombres("María Fernanda Quintero Salas", "María Quintero Salas");
    expect(r.nivel).toBe("probable_duplicado");
    expect(r.posible_familia).toBe(false);
  });

  it("DUPLICADO · mismo nombre completo con distinta capitalización y acentos", async () => {
    const r = await analizarParecidoNombres("JOSÉ RAMÓN ÁVILA", "jose ramon avila");
    expect(r.nivel).toBe("probable_duplicado");
    expect(r.similitud).toBe(1);
    expect(r.posible_familia).toBe(false);
  });

  it("FAMILIA · nombres de pila completamente distintos, mismo apellido", async () => {
    const r = await analizarParecidoNombres("Bruno Villalobos Prieto", "Ximena Villalobos Prieto");
    expect(r.nivel).toBe("probable_familia");
    expect(r.posible_familia).toBe(true);
    expect(r.motivo).toMatch(/DOS personas/);
  });

  it("FAMILIA · uno de los nombres es una descripción de parentesco, no un nombre", async () => {
    const r = await analizarParecidoNombres("Esposa de Bruno Villalobos", "Bruno Villalobos Prieto");
    expect(r.nivel).toBe("probable_familia");
    expect(r.posible_familia).toBe(true);
    expect(r.motivo).toMatch(/PARENTESCO/);
  });

  it("🔴 la forma que engañaba al umbral: dos hermanos puntúan MÁS ALTO que una misma persona", async () => {
    // Este es el caso que demuestra por qué no hay un umbral único. Si alguien "simplifica" esto a
    // `similitud > X` en el futuro, este test se pone rojo y explica por qué.
    const hermanos = await analizarParecidoNombres("Ana Villalobos Echeverría", "Eva Villalobos Echeverría");
    const mismaPersona = await analizarParecidoNombres("María Guadalupe Esperanza Quintero Salas", "María Quintero Salas");

    expect(hermanos.similitud).toBeGreaterThan(mismaPersona.similitud);
    expect(hermanos.nivel).toBe("probable_familia");
    expect(mismaPersona.nivel).toBe("probable_duplicado");
  });

  it("más formas de duplicado que el motor tiene que reconocer", async () => {
    for (const [a, b] of [
      ["María Quintero Salas", "María Quintero"],            // apellido de casada añadido
      ["Ana L Villalobos", "Ana Villalobos"],                 // inicial del segundo nombre
      ["Quintero Salas María", "María Quintero Salas"],       // apellido delante
    ] as const) {
      const r = await analizarParecidoNombres(a, b);
      expect(r.nivel, `${a} || ${b}`).toBe("probable_duplicado");
    }
  });

  it("más formas de familia que el motor tiene que reconocer", async () => {
    for (const [a, b] of [
      ["Ana Villalobos", "Eva Villalobos"],                   // pila corta, un apellido
      ["Sra Quintero madre", "María Quintero Salas"],         // honorífico + parentesco
      ["Hijo de Bruno Villalobos", "Bruno Villalobos Prieto"],
      ["Bruno Villalobos Prieto", "Ximena Ferreiro Cabal"],   // nada que ver
    ] as const) {
      const r = await analizarParecidoNombres(a, b);
      expect(r.nivel, `${a} || ${b}`).toBe("probable_familia");
    }
  });

  it("sin nombre utilizable dice «no lo sé», que no es lo mismo que decir «son la misma persona»", async () => {
    const r = await analizarParecidoNombres("", "María Quintero Salas");
    expect(r.nivel).toBe("dudoso");
    expect(r.posible_familia).toBe(false);
  });

  it("LIMITACIÓN CONOCIDA · una errata por transposición cae en probable_familia (sobreavisar es el lado seguro)", async () => {
    // `similarity('prieto','preito')` = 0.2727: una transposición destruye los trigramas y queda por
    // debajo del umbral de token (0.4), donde no cabe subirlo sin empezar a emparejar apellidos
    // genuinamente distintos (`salas`/`sales` = 0.3333). Así que este duplicado real se avisa como
    // familia. ES LA DIRECCIÓN CORRECTA DEL ERROR: sobreavisar cuesta una segunda mirada; no avisar
    // destruye el expediente de un dependiente. Si algún día esto pasa a `probable_duplicado`, que
    // sea una decisión y no un descuido — por eso está escrito como test.
    const r = await analizarParecidoNombres("Bruno Villalobos Prieto", "Bruno Villalobos Preito");
    expect(r.nivel).toBe("probable_familia");
  });

  it("normalizar quita acentos, capitalización y puntuación", () => {
    expect(normalizarNombre("  JOSÉ  RAMÓN,  ÁVILA-Núñez ")).toBe("jose ramon avila nunez");
    expect(normalizarNombre(null)).toBe("");
  });

  it("los umbrales están donde dicen las medidas", () => {
    // No es un test de tautología: fija los números para que moverlos exija tocar este fichero y
    // mirar el razonamiento de `contactos-dedup.ts`.
    expect(UMBRAL_TOKEN).toBe(0.4);       // entre 0.3333 (tokens distintos) y 0.5455 (errata real)
    expect(UMBRAL_SUPERSET).toBe(0.45);   // por debajo del 0.5122 del superset legítimo más flojo
  });
});
