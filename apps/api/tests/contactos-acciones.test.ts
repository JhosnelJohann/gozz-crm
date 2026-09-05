// ============================================================================================
// ACCIONES MASIVAS · OLA 3 · ETAPA 2 — cambiar responsable y agregar tarea
//
// Las dos escriben sobre CONJUNTOS que con "seleccionar el total" son miles de contactos, así que
// lo que se prueba aquí no es que la sentencia funcione: es que no se pueda destrozar el trabajo de
// nadie sin dejar rastro. En concreto:
//
//   · que un `undefined` no acabe borrando el responsable de cientos de fichas;
//   · que un responsable inexistente no deje datos apuntando a basura;
//   · que la auditoría guarde el responsable ANTERIOR, que es lo único que permite deshacer;
//   · y que la creación masiva de tareas registre los IDS de lo que creó, porque borrarlas está
//     prohibido (§0) y el camino de vuelta —cancelarlas— necesita saber cuáles fueron.
//
// 🔴 Todo sintético y en la base desechable.
// ============================================================================================

import { beforeAll, describe, expect, it } from "vitest";
import { query } from "../src/shared/db.js";
import {
  MAX_TAREAS_POR_OPERACION, asignarResponsable, crearTareasParaContactos,
  leerResponsableId, validarResponsableAsignable,
} from "../src/lib/contactos-acciones.js";
import { esAdminEnBase } from "../src/lib/permisos.js";
import { NOMBRE_BASE_PRUEBAS, verificarBasePruebas } from "./setup/test-db.js";
import { crearContacto, usuarioDePruebas } from "./fixtures.js";

verificarBasePruebas(process.env.DATABASE_URL || "");

beforeAll(async () => {
  const [{ db }] = await query<any>(`SELECT current_database() AS db`);
  expect(db).toBe(NOMBRE_BASE_PRUEBAS);
});

const sinHijos = { ops: 0, tareas: 0, notas: 0, correos: 0, documentos: 0 };

async function crearUsuario(etiqueta: string, nivel = "admin", activo = true): Promise<string> {
  const r = await query<any>(
    `INSERT INTO gozz.users (email, password_hash, nombre, nivel_acceso, activo)
     VALUES ($1, 'no-es-un-hash', $2, $3, $4) RETURNING id`,
    [`${etiqueta}@pruebas.invalid`, `Usuario ${etiqueta}`, nivel, activo]
  );
  return r[0].id;
}

/** Un puñado de contactos sintéticos con un marcador común para poder recuperarlos. */
async function crearContactos(n: number, marca: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(await crearContacto({
      nombre: `${marca} ${i}`, email: `${marca}-${i}@pruebas.invalid`,
      telefono: `+1900${String(i).padStart(6, "0")}`, hijos: sinHijos,
    }));
  }
  return ids;
}

const responsablesDe = async (ids: string[]) =>
  (await query<any>(
    `SELECT id, responsable_user_id FROM gozz.contactos_cache WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [ids]
  ));

describe("A · cambiar responsable", () => {
  it("asigna el responsable a TODO el conjunto en una sola operación", async () => {
    const s = Date.now().toString(36);
    const jefe = await crearUsuario(`jefe-${s}`);
    const ids = await crearContactos(4, `Resp ${s}`);
    const actor = await usuarioDePruebas();

    const r = await asignarResponsable(ids, jefe, { userId: actor });

    expect(r.cambiados).toBe(4);
    expect(r.sin_cambios).toBe(0);
    for (const c of await responsablesDe(ids)) expect(c.responsable_user_id).toBe(jefe);
    // Y el aviso es UNO que resume, no cuatro.
    expect(r.notificar).toEqual({ userId: jefe, contactos: 4 });
  });

  it("es idempotente: repetirlo no vuelve a escribir ni a auditar", async () => {
    const s = Date.now().toString(36);
    const jefe = await crearUsuario(`jefe2-${s}`);
    const ids = await crearContactos(3, `Idem ${s}`);
    const actor = await usuarioDePruebas();

    await asignarResponsable(ids, jefe, { userId: actor });
    const auditoriasTras1 = await contarAuditoria(ids);
    const r2 = await asignarResponsable(ids, jefe, { userId: actor });

    expect(r2.cambiados).toBe(0);
    expect(r2.sin_cambios).toBe(3);
    expect(r2.notificar, "sin cambios no se molesta a nadie").toBeUndefined();
    expect(await contarAuditoria(ids)).toBe(auditoriasTras1);
  });

  it("🔴 la auditoría guarda una fila por contacto CON el responsable anterior", async () => {
    // Sin el valor anterior, una reasignación masiva equivocada no se puede deshacer: no habría
    // forma de saber a quién pertenecía cada ficha antes.
    const s = Date.now().toString(36);
    const primero = await crearUsuario(`ant-${s}`);
    const segundo = await crearUsuario(`nuevo-${s}`);
    const ids = await crearContactos(3, `Aud ${s}`);
    const actor = await usuarioDePruebas();

    await asignarResponsable(ids, primero, { userId: actor });
    await asignarResponsable(ids, segundo, { userId: actor });

    const filas = await query<any>(
      `SELECT registro_id, datos_antes, datos_despues, accion FROM gozz.auditoria
        WHERE tabla_afectada = 'contactos_cache' AND registro_id = ANY($1::text[])
          AND accion LIKE 'Cambió el responsable%'
        ORDER BY created_at`,
      [ids]
    );
    // Dos rondas × 3 contactos.
    expect(filas).toHaveLength(6);
    const segundaRonda = filas.slice(3);
    for (const f of segundaRonda) {
      expect(f.datos_antes.responsable_user_id, "el responsable que había").toBe(primero);
      expect(f.datos_despues.responsable_user_id).toBe(segundo);
    }
  });

  it("responsableId: null explícito LIMPIA el responsable, y se audita como tal", async () => {
    const s = Date.now().toString(36);
    const jefe = await crearUsuario(`limpia-${s}`);
    const ids = await crearContactos(2, `Null ${s}`);
    const actor = await usuarioDePruebas();

    await asignarResponsable(ids, jefe, { userId: actor });
    const r = await asignarResponsable(ids, null, { userId: actor });

    expect(r.cambiados).toBe(2);
    expect(r.notificar, "quitar responsable no notifica a nadie").toBeUndefined();
    for (const c of await responsablesDe(ids)) expect(c.responsable_user_id).toBeNull();

    const [aud] = await query<any>(
      `SELECT accion, datos_antes FROM gozz.auditoria
        WHERE registro_id = $1 AND accion LIKE 'Quitó el responsable%' ORDER BY created_at DESC LIMIT 1`,
      [ids[0]]
    );
    expect(aud).toBeTruthy();
    expect(aud.datos_antes.responsable_user_id).toBe(jefe);
  });

  it("🔴 el campo AUSENTE no es lo mismo que null: se rechaza", async () => {
    // Un `undefined` tratado como null asignaría "sin responsable" a cientos de contactos por un
    // typo en la clave o un estado de React sin inicializar. Tiene que ser un error, no un borrado.
    expect(leerResponsableId({}).error).toMatch(/responsableId requerido/);
    expect(leerResponsableId({ seleccion: {} }).error).toMatch(/null de forma explícita/);
    expect(leerResponsableId(undefined).error).toBeTruthy();

    // Y el null explícito sí pasa, con su valor.
    expect(leerResponsableId({ responsableId: null })).toEqual({ responsableId: null });
    const uuid = "11111111-2222-3333-4444-555555555555";
    expect(leerResponsableId({ responsableId: uuid })).toEqual({ responsableId: uuid });
    // Cualquier otra cosa, fuera.
    expect(leerResponsableId({ responsableId: "" }).error).toBeTruthy();
    expect(leerResponsableId({ responsableId: 42 }).error).toBeTruthy();
    expect(leerResponsableId({ responsableId: "no-soy-un-uuid" }).error).toBeTruthy();
  });

  it("un responsable inexistente o inactivo se rechaza ANTES de escribir", async () => {
    const s = Date.now().toString(36);
    const inactivo = await crearUsuario(`inactivo-${s}`, "admin", false);
    const activo = await crearUsuario(`activo-${s}`);

    const inexistente = await validarResponsableAsignable("11111111-2222-3333-4444-555555555555");
    expect(inexistente).toEqual({ ok: false, error: "el responsable indicado no existe" });

    const baja = await validarResponsableAsignable(inactivo);
    expect(baja.ok).toBe(false);
    expect((baja as any).error).toMatch(/inactivo/);

    expect(await validarResponsableAsignable(activo)).toEqual({ ok: true });
    expect(await validarResponsableAsignable(null), "quitar responsable siempre vale").toEqual({ ok: true });
  });

  it("🔴 y si la validación se saltara, la FK aborta y NO deja escrituras a medias", async () => {
    // Defensa en profundidad: la ruta valida, pero si alguien llamara al motor con un uuid que no
    // existe, `responsable_user_id` tiene FK a `users` y la transacción entera se cae. Lo que NO
    // puede pasar es que algunos contactos queden cambiados y otros no.
    const s = Date.now().toString(36);
    const ids = await crearContactos(3, `FK ${s}`);
    const actor = await usuarioDePruebas();
    const antes = await responsablesDe(ids);

    await expect(
      asignarResponsable(ids, "99999999-8888-7777-6666-555555555555", { userId: actor })
    ).rejects.toThrow();

    expect(await responsablesDe(ids), "cero escrituras").toEqual(antes);
  });
});

async function contarAuditoria(ids: string[]): Promise<number> {
  const [r] = await query<any>(
    `SELECT count(*)::int AS n FROM gozz.auditoria WHERE registro_id = ANY($1::text[])`,
    [ids]
  );
  return r.n;
}

describe("B · agregar tarea en masa", () => {
  it("crea UNA tarea por contacto, con los campos puestos", async () => {
    const s = Date.now().toString(36);
    const actor = await usuarioDePruebas();
    const responsable = await crearUsuario(`tresp-${s}`);
    const ids = await crearContactos(4, `Tarea ${s}`);

    const r = await crearTareasParaContactos(ids, {
      titulo: `Llamar al cliente ${s}`,
      descripcion: "Revisar su expediente",
      responsable_id: responsable,
      prioridad: "alta",
      fecha_limite: "2026-12-31T00:00:00Z",
      checklist: [{ texto: "Confirmar teléfono" }],
      observadores: [actor],
    }, { userId: actor });

    expect(r.creadas).toBe(4);
    expect(r.tareaIds).toHaveLength(4);

    const tareas = await query<any>(
      `SELECT id, titulo, descripcion, contacto_id, responsable_id, propietario_id, prioridad,
              estado, checklist, observadores
         FROM gozz.tareas WHERE id = ANY($1::uuid[]) ORDER BY contacto_id`,
      [r.tareaIds]
    );
    expect(tareas).toHaveLength(4);
    // Una por contacto, sin repetir ni saltarse ninguno.
    expect(new Set(tareas.map((t) => t.contacto_id))).toEqual(new Set(ids));
    for (const t of tareas) {
      expect(t.titulo).toBe(`Llamar al cliente ${s}`);
      expect(t.descripcion).toBe("Revisar su expediente");
      expect(t.responsable_id).toBe(responsable);
      expect(t.propietario_id).toBe(actor);
      expect(t.prioridad).toBe("alta");
      expect(t.estado).toBe("pendiente");
      expect(t.checklist).toEqual([{ texto: "Confirmar teléfono" }]);
      expect(t.observadores).toEqual([actor]);
    }
    expect(r.notificar).toEqual({ userId: responsable, tareas: 4 });
  });

  it("🔴 la fila de auditoría trae los IDS de las tareas creadas — sin eso no se puede deshacer", async () => {
    // Crear 3.806 tareas por error es un desastre operativo, y borrarlas está PROHIBIDO (§0). El
    // camino de vuelta es cancelarlas, y para eso hay que saber cuáles salieron de esta operación.
    // Sin la lista, deshacer sería adivinar por fecha y arrastraría tareas de otras personas.
    const s = Date.now().toString(36);
    const actor = await usuarioDePruebas();
    const ids = await crearContactos(3, `Undo ${s}`);

    const r = await crearTareasParaContactos(ids, { titulo: `Masiva a deshacer ${s}` }, { userId: actor });

    const [aud] = await query<any>(`SELECT * FROM gozz.auditoria WHERE id = $1`, [r.auditoriaId]);
    expect(aud).toBeTruthy();
    expect(aud.tabla_afectada).toBe("tareas");
    expect(aud.accion).toContain("3 tarea(s) en masa");
    expect(aud.datos_despues.tareas_creadas).toBe(3);
    expect(aud.datos_despues.tarea_ids, "los ids, uno a uno").toEqual(r.tareaIds);
    expect(aud.datos_despues.contacto_ids).toEqual(ids);

    // Y con esa lista, deshacer es exacto: se CANCELAN, no se borran (§0).
    await query(
      `UPDATE gozz.tareas SET estado = 'cancelada'
        WHERE id = ANY (ARRAY(SELECT jsonb_array_elements_text(datos_despues->'tarea_ids')::uuid
                                FROM gozz.auditoria WHERE id = $1))`,
      [r.auditoriaId]
    );
    const estados = await query<any>(
      `SELECT DISTINCT estado FROM gozz.tareas WHERE id = ANY($1::uuid[])`, [r.tareaIds]
    );
    expect(estados).toEqual([{ estado: "cancelada" }]);
    // Canceladas, no borradas: las filas siguen ahí.
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.tareas WHERE id = ANY($1::uuid[])`, [r.tareaIds]
    );
    expect(n).toBe(3);
  });

  it("sin responsable explícito, la tarea es de quien la crea y no se notifica a nadie", async () => {
    const s = Date.now().toString(36);
    const actor = await usuarioDePruebas();
    const ids = await crearContactos(2, `Propio ${s}`);

    const r = await crearTareasParaContactos(ids, { titulo: `Mía ${s}` }, { userId: actor });

    const tareas = await query<any>(
      `SELECT responsable_id, propietario_id FROM gozz.tareas WHERE id = ANY($1::uuid[])`,
      [r.tareaIds]
    );
    for (const t of tareas) {
      expect(t.responsable_id).toBe(actor);
      expect(t.propietario_id).toBe(actor);
    }
    expect(r.notificar, "no te notificas a ti mismo").toBeUndefined();
  });

  it("el tope se declara y se rechaza con el número, no se recorta en silencio", async () => {
    // Un tope que recorta sin avisar hace creer que se crearon todas. Este avisa.
    const s = Date.now().toString(36);
    const actor = await usuarioDePruebas();
    const falsos = Array.from({ length: MAX_TAREAS_POR_OPERACION + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

    await expect(
      crearTareasParaContactos(falsos, { titulo: "No debería crearse" }, { userId: actor })
    ).rejects.toThrow(new RegExp(`máximo por operación es ${MAX_TAREAS_POR_OPERACION}`));

    // Y no creó ni una.
    const [{ n }] = await query<any>(
      `SELECT count(*)::int AS n FROM gozz.tareas WHERE titulo = 'No debería crearse'`
    );
    expect(n).toBe(0);
  });
});

describe("permisos · el rol se consulta a la BASE, no al JWT", () => {
  it("un usuario normal no es admin, aunque su token dijera otra cosa", async () => {
    // 🔴 El motivo (§2.4): los tokens duran 365 días y no se refrescan. A quien le quiten el rol lo
    // conserva en su JWT hasta un año. Para una acción que escribe sobre miles de contactos, la
    // pregunta correcta es qué es esa persona AHORA.
    const s = Date.now().toString(36);
    const normal = await crearUsuario(`normal-${s}`, "usuario");
    const admin = await crearUsuario(`admin-${s}`, "admin");
    const superAdmin = await crearUsuario(`super-${s}`, "super_admin");

    expect(await esAdminEnBase(normal)).toBe(false);
    expect(await esAdminEnBase(admin)).toBe(true);
    expect(await esAdminEnBase(superAdmin)).toBe(true);
  });

  it("un admin DADO DE BAJA deja de serlo de inmediato", async () => {
    const s = Date.now().toString(36);
    const id = await crearUsuario(`baja-${s}`, "admin");
    expect(await esAdminEnBase(id)).toBe(true);

    await query(`UPDATE gozz.users SET activo = false WHERE id = $1`, [id]);
    expect(await esAdminEnBase(id), "su token seguiría diciendo admin hasta un año").toBe(false);
  });

  it("un id inexistente o vacío no es admin", async () => {
    expect(await esAdminEnBase("11111111-2222-3333-4444-555555555555")).toBe(false);
    expect(await esAdminEnBase(null)).toBe(false);
    expect(await esAdminEnBase("")).toBe(false);
  });
});
