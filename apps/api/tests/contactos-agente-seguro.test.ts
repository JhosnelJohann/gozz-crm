// ============================================================================================
// EL AGENTE DE SEGURO DE SALUD — `src/lib/contactos-agente-seguro.ts` y el CHECK de la mig. 0070
//
// El campo existe para **segmentar la cartera por agente**. Todo lo que se vigila aquí protege esa
// agrupación de una forma distinta de ensuciarse:
//
//   · un agente que no vale se RECHAZA, nunca se guarda como «sin agente» (§2.8.3);
//   · las dos columnas son EXCLUYENTES, y lo impide la BASE — no solo la API;
//   · un contacto sin seguro no puede quedarse con un agente asignado.
//
// 🔴 EL CASO QUE MÁS IMPORTA es el del usuario INACTIVO. En la base real hay un `Julio Laya`
// inactivo con el mismo apellido que una de las dos agentes: una comprobación de "existe" a secas
// lo aceptaría. Por eso se mira `activo`, y por eso en toda esta funcionalidad no se busca a nadie
// por apellido — ni al sembrar, ni al listar.
//
// 🔴 Fixtures sintéticos (§9.3), en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";

import { query } from "../src/shared/db.js";
import {
  AGENTE_NO_VALIDO, EMAILS_AGENTES_SEGURO, esAgenteAsignable, listarAgentesSeguro,
  ordenarAgentesOfrecidos, pierdeElSeguro, resolverAgenteSeguro,
} from "../src/lib/contactos-agente-seguro.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

let contador = 0;
const sufijo = () => `${Date.now().toString(36)}-${++contador}`;

async function crearUsuario(activo = true): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1,'no-es-un-hash','Persona de prueba','usuario',$2) RETURNING id`,
    [`agente-${sufijo()}@pruebas.invalid`, activo]
  );
  return r[0].id;
}

async function crearContacto(): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.contactos_cache (nombre_completo, tiene_seguro_salud)
     VALUES ($1, true) RETURNING id`,
    [`ZZ Contacto ${sufijo()}`]
  );
  return r[0].id;
}

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

describe("a quién se le puede asignar", () => {
  it("a un usuario activo, sí", async () => {
    expect(await esAgenteAsignable(await crearUsuario(true))).toBe(true);
  });

  it("🔴 a uno INACTIVO, no — aunque exista", async () => {
    expect(await esAgenteAsignable(await crearUsuario(false))).toBe(false);
  });

  it("a uno que no existe, tampoco", async () => {
    expect(await esAgenteAsignable("00000000-0000-0000-0000-0000000000ee")).toBe(false);
  });
});

describe("🔴 qué se guarda, y qué se rechaza", () => {
  it("un agente válido se guarda y limpia el texto", async () => {
    const u = await crearUsuario(true);
    const r = await resolverAgenteSeguro({ agente_seguro_id: u, agente_seguro_otro: "algo que sobra" });
    expect(r).toEqual({ ok: true, agente_seguro_id: u, agente_seguro_otro: null });
  });

  it("🔴 uno inválido se RECHAZA; NO se coacciona a null", async () => {
    // Es la diferencia entera. Coaccionar a null devolvería `ok: true` con el campo vacío: el
    // contacto saldría del CRM como "sin agente" y quien lo puso creería que segmentó.
    for (const id of ["00000000-0000-0000-0000-0000000000ee", await crearUsuario(false)]) {
      const r = await resolverAgenteSeguro({ agente_seguro_id: id });
      expect(r.ok, id).toBe(false);
      expect((r as any).error).toBe(AGENTE_NO_VALIDO);
    }
  });

  it("el mensaje no nombra la columna ni enseña identificadores (§4.7)", () => {
    expect(AGENTE_NO_VALIDO).not.toContain("agente_seguro");
    expect(AGENTE_NO_VALIDO).not.toContain("users");
    expect(AGENTE_NO_VALIDO).toContain("Otro");
  });

  it("«Otro» guarda el texto y deja el uuid en null", async () => {
    expect(await resolverAgenteSeguro({ agente_seguro_otro: "Agencia de fuera" }))
      .toEqual({ ok: true, agente_seguro_id: null, agente_seguro_otro: "Agencia de fuera" });
  });

  it("un texto en blanco es «no hay agente», no un agente que se llama espacios", async () => {
    for (const v of ["", "   ", null]) {
      expect(await resolverAgenteSeguro({ agente_seguro_otro: v as any }))
        .toEqual({ ok: true, agente_seguro_id: null, agente_seguro_otro: null });
    }
  });
});

describe("cuándo se pierde el agente", () => {
  it("al dejar de tener seguro, y también cuando no se sabe", () => {
    // Los tres estados de la columna son sí / no / no se sabe, y solo el primero justifica que
    // haya un agente: agrupar por agente sacaría gente sin seguro.
    expect(pierdeElSeguro(false)).toBe(true);
    expect(pierdeElSeguro(null)).toBe(true);
    expect(pierdeElSeguro(true)).toBe(false);
  });
});

describe("🔴 el CHECK de la migración 0070 — la base, no solo la API", () => {
  it("cada columna por separado se acepta", async () => {
    const c = await crearContacto();
    const u = await crearUsuario(true);
    await query("UPDATE gozz.contactos_cache SET agente_seguro_id = $2 WHERE id = $1", [c, u]);
    await query("UPDATE gozz.contactos_cache SET agente_seguro_id = NULL, agente_seguro_otro = $2 WHERE id = $1", [c, "Externo"]);
    const [f] = await query<any>("SELECT agente_seguro_id, agente_seguro_otro FROM gozz.contactos_cache WHERE id = $1", [c]);
    expect(f.agente_seguro_id).toBeNull();
    expect(f.agente_seguro_otro).toBe("Externo");
  });

  it("🔴 las DOS a la vez las rechaza POSTGRES, no la API", async () => {
    // La API no es el único camino: un UPDATE suelto o una importación también escriben aquí. Una
    // sola fila con las dos rellenas no significa nada —¿el agente es la persona o el texto?— y
    // ensucia cualquier recuento por agente.
    const c = await crearContacto();
    const u = await crearUsuario(true);
    await expect(
      query("UPDATE gozz.contactos_cache SET agente_seguro_id = $2, agente_seguro_otro = $3 WHERE id = $1",
            [c, u, "Externo"])
    ).rejects.toMatchObject({ code: "23514", constraint: "contactos_cache_agente_seguro_excluyente" });
  });

  it("las dos en NULL sí valen: es «no lo sabemos todavía»", async () => {
    const c = await crearContacto();
    await query("UPDATE gozz.contactos_cache SET agente_seguro_id = NULL, agente_seguro_otro = NULL WHERE id = $1", [c]);
    const [f] = await query<any>("SELECT agente_seguro_id FROM gozz.contactos_cache WHERE id = $1", [c]);
    expect(f.agente_seguro_id).toBeNull();
  });

  it("🔴 al borrar el usuario, la etiqueta se vacía y el contacto SIGUE (ON DELETE SET NULL)", async () => {
    // No es una firma sino una etiqueta de segmentación: bloquear el borrado de un usuario por
    // esto sería desproporcionado, y perder el contacto sería catastrófico.
    const c = await crearContacto();
    const u = await crearUsuario(true);
    await query("UPDATE gozz.contactos_cache SET agente_seguro_id = $2 WHERE id = $1", [c, u]);
    await query("DELETE FROM gozz.users WHERE id = $1", [u]);

    const [f] = await query<any>("SELECT id, agente_seguro_id FROM gozz.contactos_cache WHERE id = $1", [c]);
    expect(f, "el contacto sigue existiendo").toBeTruthy();
    expect(f.agente_seguro_id, "la etiqueta se vació sola").toBeNull();
  });
});

// ============================================================================================
// QUIÉNES SE OFRECEN EN LA PANTALLA (tanda C4)
//
// 🔴 SE RESUELVEN POR EMAIL Y NO POR UUID, y eso es lo que estas pruebas protegen. Staging y
// producción son **bases distintas**: las mismas dos personas tienen un `id` diferente en cada
// una. Un uuid escrito en el código funcionaría en un entorno y en el otro no encontraría a nadie
// —en silencio, guardando "sin agente"—, que es el fallo que no se ve hasta que alguien pregunta
// por qué una campaña salió corta.
// ============================================================================================

describe("los agentes que se ofrecen en la ficha", () => {
  it("son exactamente dos, y por email", () => {
    expect([...EMAILS_AGENTES_SEGURO]).toEqual([
      "alessandro.garagozzo@gozz-agencia.com",
      "jhosnel.laya@gmail.com",
    ]);
  });

  it("🔴 se respeta el orden de la constante, no el que devuelva Postgres", () => {
    // Es una lista de dos y se lee mejor estable. Ordenar por lo que salga de la base la haría
    // cambiar de orden con cualquier reindexado.
    const alReves = [
      { id: "b", nombre: "Jhosnel Laya", email: "jhosnel.laya@gmail.com" },
      { id: "a", nombre: "Alessandro Garagozzo", email: "alessandro.garagozzo@gozz-agencia.com" },
    ];
    expect(ordenarAgentesOfrecidos(alReves).map((x) => x.nombre))
      .toEqual(["Alessandro Garagozzo", "Jhosnel Laya"]);
  });

  it("🔴 quien no está en el entorno NO se ofrece: nada de opciones muertas", () => {
    // Ofrecer una opción que al guardar devuelve 400 es peor que no ofrecerla: quien la elige
    // cree que ha segmentado y descubre el fallo al pulsar Guardar, si es que lo descubre.
    const soloUno = [{ id: "a", nombre: "Alessandro Garagozzo", email: "alessandro.garagozzo@gozz-agencia.com" }];
    expect(ordenarAgentesOfrecidos(soloUno)).toEqual([{ id: "a", nombre: "Alessandro Garagozzo" }]);
    expect(ordenarAgentesOfrecidos([]), "y si no está ninguno, ninguna opción").toEqual([]);
  });

  it("el email se compara sin distinguir mayúsculas ni espacios", () => {
    const raro = [{ id: "a", nombre: "Alessandro Garagozzo", email: "  Alessandro.Garagozzo@Gozz-Agencia.COM " }];
    expect(ordenarAgentesOfrecidos(raro)).toHaveLength(1);
  });

  it("🔴 el NOMBRE sale de la base, no del código", () => {
    // Si a alguien le corrigen el nombre en Configuración, la ficha se entera sola. Escribirlo
    // aquí sería una segunda verdad esperando a divergir (§4.7).
    const renombrado = [{ id: "a", nombre: "Alessandro M. Garagozzo Rodríguez", email: "alessandro.garagozzo@gozz-agencia.com" }];
    expect(ordenarAgentesOfrecidos(renombrado)[0].nombre).toBe("Alessandro M. Garagozzo Rodríguez");
  });

  it("un usuario sin nombre cae a su email, no a una cadena vacía", () => {
    const sinNombre = [{ id: "a", nombre: "   ", email: "jhosnel.laya@gmail.com" }];
    expect(ordenarAgentesOfrecidos(sinNombre)[0].nombre).toBe("jhosnel.laya@gmail.com");
  });

  it("no devuelve a nadie más, aunque la base traiga otros", () => {
    const conIntrusos = [
      { id: "x", nombre: "Albany Marques", email: "albany@pruebas.invalid" },
      { id: "a", nombre: "Alessandro Garagozzo", email: "alessandro.garagozzo@gozz-agencia.com" },
    ];
    expect(ordenarAgentesOfrecidos(conIntrusos).map((x) => x.id)).toEqual(["a"]);
  });

  it("contra la base: solo salen los que existen y están ACTIVOS", async () => {
    // Los dos emails son de personas reales que en la base desechable no existen, así que la
    // consulta tiene que devolver vacío sin romperse. Es el caso de un entorno recién levantado.
    // (Solo vale si nadie los ha sembrado todavia en esta base; la comprobacion util es la de
    //  abajo, que si es independiente del orden en que corran los ficheros.)
    expect(Array.isArray(await listarAgentesSeguro())).toBe(true);

    // Y con uno sembrado con ese email exacto, sale; desactivado, no.
    const [u] = await query<any>(
      `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
       VALUES ($1,'no-es-un-hash','Jhosnel Laya','admin',true)
       ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true RETURNING id`,
      ["jhosnel.laya@gmail.com"]
    );
    expect(await listarAgentesSeguro()).toContainEqual({ id: u.id, nombre: "Jhosnel Laya" });

    await query("UPDATE gozz.users SET activo = false WHERE id = $1", [u.id]);
    expect((await listarAgentesSeguro()).map((a) => a.id), "un agente dado de baja deja de ofrecerse")
      .not.toContain(u.id);
  });
});
