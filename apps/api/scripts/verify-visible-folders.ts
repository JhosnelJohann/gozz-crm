/**
 * verify-visible-folders.ts
 * --------------------------------------------------------------------------
 * Script de SOLO LECTURA para validar el fix de `visibleFolders` en
 * apps/api/src/drive-routes.ts (cambio O(n^2) -> O(n) + guardas de ciclo).
 *
 * Qué hace:
 *  1. Carga TODAS las carpetas vivas (deleted_at IS NULL) desde la base real
 *     (o desde un dump JSON si se pasa --dump=ruta.json).
 *  2. Reimplementa visibleFolders en DOS versiones — VIEJA (O(n^2)) y NUEVA
 *     (O(n) + guardas) — como funciones puras sobre datos en memoria.
 *  3. Para tres perfiles (admin, usuario con oportunidades, usuario común)
 *     ejecuta ambas versiones y compara que el conjunto de folders.id sea
 *     EXACTAMENTE idéntico. Reporta cualquier carpeta que aparezca o
 *     desaparezca.
 *  4. Mide el tiempo de cada versión (before vs after) sobre los datos reales.
 *
 * NO modifica nada en la base. Solo SELECT.
 *
 * Uso (desde apps/api):
 *   # contra la base configurada en DATABASE_URL (.env)
 *   npx tsx scripts/verify-visible-folders.ts
 *
 *   # saltando la versión vieja (que tarda 1-2 min con 60k carpetas):
 *   npx tsx scripts/verify-visible-folders.ts --skip-old
 *
 *   # usando un dump JSON en vez de la DB (array de folders):
 *   npx tsx scripts/verify-visible-folders.ts --dump=./drive_folders.json --user-admin=<id> --user-opp=<id> --user-common=<id>
 *
 * Generar el dump JSON (solo lectura), por ejemplo:
 *   psql "$DATABASE_URL" -A -t -c "SELECT json_agg(t) FROM (SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE deleted_at IS NULL) t" > drive_folders.json
 */
import pg from "pg";
import "dotenv/config";
import { readFileSync } from "node:fs";

type Folder = {
  id: string;
  nombre: string;
  parent_id: string | null;
  tipo: string;
  owner_user_id: string | null;
  oportunidad_id: string | null;
};

type User = { sub: string; nivel: string };

// ===========================================================================
// VERSIÓN VIEJA  (copiada tal cual de drive-routes.ts ANTES del fix)
// Recibe `all` y `opIds` como parámetros en vez de consultar la DB, para
// poder compararla en memoria. La lógica de filtrado es idéntica al original.
// ===========================================================================
export function visibleFoldersOld(all: Folder[], opIds: string[], user: User): Folder[] {
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";

  if (isAdmin) {
    const filtered = all.filter((f) => {
      if (f.tipo !== "user") return true;
      return f.owner_user_id === user.sub;
    });
    const byId = new Map(filtered.map((f) => [f.id, f]));
    return filtered.filter((f) => {
      let cur: Folder | undefined = f;
      while (cur?.parent_id) {
        if (!byId.has(cur.parent_id)) return false;
        cur = byId.get(cur.parent_id);
      }
      return true;
    });
  }

  const allowed = new Set<string>();
  const byId = new Map(all.map((f) => [f.id, f]));

  const addAncestors = (id: string) => {
    let cur: Folder | undefined = byId.get(id);
    while (cur) {
      allowed.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  };
  const addDescendants = (id: string) => {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      allowed.add(cur);
      for (const f of all) if (f.parent_id === cur) stack.push(f.id); // O(n^2)
    }
  };
  const isUnderForeignUser = (id: string): boolean => {
    let cur: Folder | undefined = byId.get(id);
    while (cur) {
      if (cur.tipo === "user") return cur.owner_user_id !== user.sub;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  for (const f of all) {
    if (f.tipo === "root" || f.tipo === "users_root" || f.tipo === "opportunities_root") {
      allowed.add(f.id);
    }
    if (f.tipo === "company") {
      addDescendants(f.id);
    }
    if (f.tipo === "user" && f.owner_user_id === user.sub) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    if (f.tipo === "opportunity" && f.oportunidad_id && opIds.includes(f.oportunidad_id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    if (f.tipo === "custom" && !isUnderForeignUser(f.id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
  }
  return all.filter((f) => allowed.has(f.id));
}

// ===========================================================================
// VERSIÓN NUEVA  (copiada tal cual de drive-routes.ts DESPUÉS del fix)
// ===========================================================================
export function visibleFoldersNew(all: Folder[], opIds: string[], user: User): Folder[] {
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";

  if (isAdmin) {
    const filtered = all.filter((f) => {
      if (f.tipo !== "user") return true;
      return f.owner_user_id === user.sub;
    });
    const byId = new Map(filtered.map((f) => [f.id, f]));
    return filtered.filter((f) => {
      let cur: Folder | undefined = f;
      const visited = new Set<string>();
      while (cur?.parent_id) {
        if (visited.has(cur.id)) return false;
        visited.add(cur.id);
        if (!byId.has(cur.parent_id)) return false;
        cur = byId.get(cur.parent_id);
      }
      return true;
    });
  }

  const allowed = new Set<string>();
  const byId = new Map(all.map((f) => [f.id, f]));

  const childrenByParent = new Map<string, Folder[]>();
  for (const f of all) {
    if (!f.parent_id) continue;
    const arr = childrenByParent.get(f.parent_id);
    if (arr) arr.push(f);
    else childrenByParent.set(f.parent_id, [f]);
  }

  const addAncestors = (id: string) => {
    let cur: Folder | undefined = byId.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      allowed.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  };
  const addDescendants = (id: string) => {
    const stack = [id];
    const visited = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      allowed.add(cur);
      const kids = childrenByParent.get(cur);
      if (kids) for (const f of kids) stack.push(f.id);
    }
  };
  const isUnderForeignUser = (id: string): boolean => {
    let cur: Folder | undefined = byId.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur.id)) return false;
      visited.add(cur.id);
      if (cur.tipo === "user") return cur.owner_user_id !== user.sub;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };

  for (const f of all) {
    if (f.tipo === "root" || f.tipo === "users_root" || f.tipo === "opportunities_root") {
      allowed.add(f.id);
    }
    if (f.tipo === "company") {
      addDescendants(f.id);
    }
    if (f.tipo === "user" && f.owner_user_id === user.sub) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    if (f.tipo === "opportunity" && f.oportunidad_id && opIds.includes(f.oportunidad_id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
    if (f.tipo === "custom" && !isUnderForeignUser(f.id)) {
      addAncestors(f.id);
      addDescendants(f.id);
    }
  }
  return all.filter((f) => allowed.has(f.id));
}

// ===========================================================================
// Utilidades
// ===========================================================================
function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function diffSets(oldArr: Folder[], newArr: Folder[]) {
  const oldIds = new Set(oldArr.map((f) => f.id));
  const newIds = new Set(newArr.map((f) => f.id));
  const desaparecen = [...oldIds].filter((id) => !newIds.has(id)); // estaban en VIEJA, no en NUEVA
  const aparecen = [...newIds].filter((id) => !oldIds.has(id));    // están en NUEVA, no en VIEJA
  return { oldCount: oldIds.size, newCount: newIds.size, desaparecen, aparecen };
}

async function getOpIds(pool: pg.Pool, sub: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT id FROM gozz.oportunidades
      WHERE preparador_id=$1 OR vendedor_id=$1 OR manager_preparacion_id=$1 OR
            manager_ventas_id=$1 OR supervisor_id=$1`,
    [sub]
  );
  return r.rows.map((x: any) => x.id);
}

async function main() {
  const skipOld = hasFlag("skip-old");
  const dumpPath = arg("dump");

  // ---- 1. Cargar carpetas ----
  let all: Folder[];
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 60_000 });

  if (dumpPath) {
    all = JSON.parse(readFileSync(dumpPath, "utf8"));
    console.log(`Carpetas cargadas desde dump ${dumpPath}: ${all.length}`);
  } else {
    const r = await pool.query(
      "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE deleted_at IS NULL"
    );
    all = r.rows as Folder[];
    console.log(`Carpetas vivas cargadas desde DB: ${all.length}`);
  }

  // ---- 2. Elegir tres perfiles de usuario ----
  type Profile = { label: string; user: User; opIds: string[] };
  const profiles: Profile[] = [];

  const pick = async (label: string, sql: string, overrideId?: string) => {
    let sub: string | undefined;
    let nivel = "user";
    if (overrideId) {
      const r = await pool.query("SELECT id, nivel_acceso AS nivel FROM gozz.users WHERE id=$1", [overrideId]);
      if (r.rows[0]) { sub = r.rows[0].id; nivel = r.rows[0].nivel; }
    } else {
      const r = await pool.query(sql);
      if (r.rows[0]) { sub = r.rows[0].id; nivel = r.rows[0].nivel; }
    }
    if (!sub) { console.warn(`! No se encontró usuario para perfil "${label}" — se omite.`); return; }
    const opIds = await getOpIds(pool, sub);
    profiles.push({ label, user: { sub, nivel }, opIds });
    console.log(`Perfil ${label}: user=${sub} nivel=${nivel} oportunidades=${opIds.length}`);
  };

  await pick(
    "ADMIN",
    "SELECT id, nivel_acceso AS nivel FROM gozz.users WHERE nivel_acceso IN ('super_admin','admin') AND activo = true LIMIT 1",
    arg("user-admin")
  );
  await pick(
    "USUARIO_CON_OPORTUNIDADES",
    `SELECT u.id, u.nivel_acceso AS nivel FROM gozz.users u
      WHERE u.nivel_acceso NOT IN ('super_admin','admin')
        AND EXISTS (SELECT 1 FROM gozz.oportunidades o
                     WHERE o.preparador_id=u.id OR o.vendedor_id=u.id OR o.manager_preparacion_id=u.id
                        OR o.manager_ventas_id=u.id OR o.supervisor_id=u.id)
      LIMIT 1`,
    arg("user-opp")
  );
  await pick(
    "USUARIO_COMUN",
    `SELECT u.id, u.nivel_acceso AS nivel FROM gozz.users u
      WHERE u.nivel_acceso NOT IN ('super_admin','admin')
        AND NOT EXISTS (SELECT 1 FROM gozz.oportunidades o
                         WHERE o.preparador_id=u.id OR o.vendedor_id=u.id OR o.manager_preparacion_id=u.id
                            OR o.manager_ventas_id=u.id OR o.supervisor_id=u.id)
      LIMIT 1`,
    arg("user-common")
  );

  // ---- 3 + 4. Comparar y medir ----
  let anyDiff = false;
  console.log("\n=================== RESULTADOS ===================");
  for (const p of profiles) {
    console.log(`\n--- Perfil: ${p.label} (nivel=${p.user.nivel}) ---`);

    // NUEVA (siempre)
    const tNew0 = process.hrtime.bigint();
    const resNew = visibleFoldersNew(all, p.opIds, p.user);
    const tNew1 = process.hrtime.bigint();
    const msNew = Number(tNew1 - tNew0) / 1e6;
    console.log(`  NUEVA  -> ${resNew.length} carpetas visibles  (${msNew.toFixed(1)} ms)`);

    if (skipOld) {
      console.log("  VIEJA  -> [omitida por --skip-old]");
      continue;
    }

    // VIEJA (puede tardar 1-2 min con 60k carpetas)
    const tOld0 = process.hrtime.bigint();
    const resOld = visibleFoldersOld(all, p.opIds, p.user);
    const tOld1 = process.hrtime.bigint();
    const msOld = Number(tOld1 - tOld0) / 1e6;
    console.log(`  VIEJA  -> ${resOld.length} carpetas visibles  (${msOld.toFixed(1)} ms)`);

    const speedup = msOld / Math.max(msNew, 0.001);
    console.log(`  Speedup: ${speedup.toFixed(0)}x  (${(msOld / 1000).toFixed(1)}s -> ${(msNew / 1000).toFixed(3)}s)`);

    const d = diffSets(resOld, resNew);
    if (d.desaparecen.length === 0 && d.aparecen.length === 0) {
      console.log(`  ✅ IDÉNTICO: ambos conjuntos coinciden exactamente (${d.oldCount} carpetas).`);
    } else {
      anyDiff = true;
      console.log(`  ❌ DIFERENCIA DETECTADA (vieja=${d.oldCount}, nueva=${d.newCount})`);
      if (d.desaparecen.length)
        console.log(`     Desaparecen en NUEVA (${d.desaparecen.length}): ${d.desaparecen.slice(0, 20).join(", ")}${d.desaparecen.length > 20 ? " ..." : ""}`);
      if (d.aparecen.length)
        console.log(`     Aparecen en NUEVA (${d.aparecen.length}): ${d.aparecen.slice(0, 20).join(", ")}${d.aparecen.length > 20 ? " ..." : ""}`);
    }
  }

  console.log("\n=================================================");
  console.log(anyDiff
    ? "RESULTADO FINAL: ❌ HAY DIFERENCIAS — NO mergear hasta investigar."
    : (skipOld ? "RESULTADO FINAL: NUEVA ejecutada OK (comparación con VIEJA omitida)."
               : "RESULTADO FINAL: ✅ EQUIVALENCIA CONFIRMADA en todos los perfiles."));

  await pool.end();
  process.exit(anyDiff ? 1 : 0);
}

// Solo ejecuta main() cuando el archivo se corre como entrypoint
// (no cuando se importa para tests de equivalencia en memoria).
import { pathToFileURL } from "node:url";
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  main().catch((e) => {
    console.error("Error en el script:", e);
    process.exit(2);
  });
}
