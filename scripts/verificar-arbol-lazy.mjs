#!/usr/bin/env node
// Harness BLOQUEANTE de la Entrega 3B (árbol lazy).
//
// Prueba que la visibilidad por-nodo del árbol lazy (childVisible, evaluada de a un hijo) produce EXACTAMENTE
// el mismo conjunto de carpetas que visibleFolders() (la lógica vieja, que recorre todo el grafo). Si difieren
// para ALGÚN usuario, el árbol lazy cambiaría quién ve qué → NO se mergea hasta que esto dé 0 diferencias.
//
// Uso (en staging, con DATABASE_URL apuntando a crm_staging):
//   node scripts/verificar-arbol-lazy.mjs            -> corre TODOS los usuarios; exit 1 si hay alguna diferencia
//   node scripts/verificar-arbol-lazy.mjs --verbose  -> además lista las diferencias por usuario
//
// Read-only: no escribe nada.

import pg from "pg";
import "dotenv/config";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");
const VERBOSE = process.argv.includes("--verbose");
const RESUMEN = process.argv.includes("--resumen");

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------- visibleFolders() PORTEADO EXACTO desde apps/api/src/drive-routes.ts ----------
// (mantener idéntico; es la referencia contra la que se valida el árbol lazy)
// ---------- T1 · el escondite de las ramas de clientes (porteado de drive-routes.ts) ----------
// Se aplica a las DOS implementaciones que este harness compara. Si entrara en una sola, el
// harness reportaría diferencias que no existen — o peor, taparía las que sí.
const TIPOS_RAIZ_VISIBLES = new Set(["company", "users_root"]);

/** ¿se oculta `hijoTipo` al enumerar los hijos de una carpeta de tipo `padreTipo`? */
function ocultoAlEnumerar(padreTipo, hijoTipo) {
  if (padreTipo === "root") return !TIPOS_RAIZ_VISIBLES.has(hijoTipo);
  return hijoTipo === "contact";
}

/** Quita del conjunto las ramas escondidas y TODOS sus descendientes. */
function podarSet(idSet, all) {
  const rootId = all.find((f) => f.tipo === "root")?.id ?? null;
  const semillas = [];
  for (const f of all) {
    if (rootId && f.parent_id === rootId && !TIPOS_RAIZ_VISIBLES.has(f.tipo)) semillas.push(f.id);
    else if (f.tipo === "contact") semillas.push(f.id);
  }
  if (!semillas.length) return idSet;
  const hijosPorPadre = new Map();
  for (const f of all) {
    if (!f.parent_id) continue;
    const arr = hijosPorPadre.get(f.parent_id);
    if (arr) arr.push(f); else hijosPorPadre.set(f.parent_id, [f]);
  }
  const fuera = new Set();
  const pila = [...semillas];
  while (pila.length) {
    const id = pila.pop();
    if (fuera.has(id)) continue;
    fuera.add(id);
    for (const h of hijosPorPadre.get(id) ?? []) pila.push(h.id);
  }
  const out = new Set();
  for (const id of idSet) if (!fuera.has(id)) out.add(id);
  return out;
}

function visibleFoldersOld(user, all, opIdsArr) {
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";

  if (isAdmin) {
    const filtered = all.filter((f) => (f.tipo !== "user" ? true : f.owner_user_id === user.sub));
    const byId = new Map(filtered.map((f) => [f.id, f]));
    const out = filtered.filter((f) => {
      let cur = f;
      const visited = new Set();
      while (cur && cur.parent_id) {
        if (visited.has(cur.id)) return false;
        visited.add(cur.id);
        if (!byId.has(cur.parent_id)) return false; // ancestro filtrado → este también
        cur = byId.get(cur.parent_id);
      }
      return true;
    });
    return podarSet(new Set(out.map((f) => f.id)), all);   // T1
  }

  const opIds = opIdsArr; // ids de oportunidades vinculadas al usuario
  const allowed = new Set();
  const byId = new Map(all.map((f) => [f.id, f]));
  const childrenByParent = new Map();
  for (const f of all) {
    if (!f.parent_id) continue;
    const arr = childrenByParent.get(f.parent_id);
    if (arr) arr.push(f); else childrenByParent.set(f.parent_id, [f]);
  }
  const addAncestors = (id) => {
    let cur = byId.get(id);
    const visited = new Set();
    while (cur) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      allowed.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  };
  const addDescendants = (id) => {
    const stack = [id];
    const visited = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (visited.has(cur)) continue;
      visited.add(cur);
      allowed.add(cur);
      const kids = childrenByParent.get(cur);
      if (kids) for (const f of kids) stack.push(f.id);
    }
  };
  const isUnderForeignUser = (id) => {
    let cur = byId.get(id);
    const visited = new Set();
    while (cur) {
      if (visited.has(cur.id)) return false;
      visited.add(cur.id);
      if (cur.tipo === "user") return cur.owner_user_id !== user.sub;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return false;
  };
  const opSet = new Set(opIds);
  for (const f of all) {
    if (f.tipo === "root" || f.tipo === "users_root" || f.tipo === "opportunities_root") allowed.add(f.id);
    if (f.tipo === "company") addDescendants(f.id);
    if (f.tipo === "user" && f.owner_user_id === user.sub) { addAncestors(f.id); addDescendants(f.id); }
    if (f.tipo === "opportunity" && f.oportunidad_id && opSet.has(f.oportunidad_id)) { addAncestors(f.id); addDescendants(f.id); }
    if (f.tipo === "custom" && !isUnderForeignUser(f.id)) { addAncestors(f.id); addDescendants(f.id); }
  }
  return podarSet(new Set(all.filter((f) => allowed.has(f.id)).map((f) => f.id)), all);   // T1
}

// ---------- Árbol lazy: childVisible + walk (RÉPLICA del backend drive-routes.ts, OPCIÓN A con leak) ----------
// ctx.leadsSet = ids de carpetas cuyo subárbol contiene un custom (custom o ancestro-de-custom) = "subtreeHasCustom".
function childVisible(ctx, parent, child) {
  // nadie ve Mi Drive ajeno (admin incluido)
  if (child.tipo === "user" && child.owner_user_id !== ctx.sub) return false;
  // T1 · va ANTES del atajo de admin: el escondite se aplica a todo el mundo, super_admin incluido.
  if (ocultoAlEnumerar(parent.tipo, child.tipo)) return false;
  if (ctx.isAdmin) return true;
  // bajo opportunities_root: oportunidad visible si vinculada O su subárbol tiene un custom (leak); customs directos → sí
  if (parent.tipo === "opportunities_root") {
    if (child.tipo === "opportunity") return ctx.opSet.has(child.oportunidad_id) || ctx.leadsSet.has(child.id);
    return true;
  }
  // bajo una opp NO-vinculada (visible solo por el leak): hijo visible si su subárbol tiene un custom
  if (parent.tipo === "opportunity" && parent.oportunidad_id != null && !ctx.opSet.has(parent.oportunidad_id)) {
    return ctx.leadsSet.has(child.id);
  }
  // resto (opp vinculada / custom / company / contact / users_root con Mi Drive propio…): todos los hijos
  return true;
}

function lazyWalk(ctx, root, childrenByParent) {
  const visible = new Set([root.id]); // la raíz siempre es visible (estructural)
  const stack = [root];
  const seen = new Set([root.id]);
  while (stack.length) {
    const parent = stack.pop();
    const kids = childrenByParent.get(parent.id) || [];
    for (const child of kids) {
      if (!childVisible(ctx, parent, child)) continue;
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      visible.add(child.id);
      stack.push(child);
    }
  }
  return visible;
}

function diff(a, b) {
  const onlyA = [], onlyB = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return { onlyA, onlyB };
}

async function main() {
  // Carpetas vivas (mismo universo que visibleFolders)
  const { rows: all } = await pool.query(
    "SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE deleted_at IS NULL"
  );
  const root = all.find((f) => f.tipo === "root");
  if (!root) throw new Error("no hay carpeta tipo='root'");

  const childrenByParent = new Map();
  for (const f of all) {
    if (!f.parent_id) continue;
    const arr = childrenByParent.get(f.parent_id);
    if (arr) arr.push(f); else childrenByParent.set(f.parent_id, [f]);
  }

  // Usuarios
  const { rows: users } = await pool.query(
    "SELECT id, nombre, COALESCE(nivel_acceso, 'usuario') AS nivel FROM gozz.users"
  );

  // Mapa userId -> Set(opId) desde TODOS los roles de oportunidades, en una sola query
  const opByUser = new Map();
  const addOp = (uid, opId) => { if (!uid) return; const s = opByUser.get(uid) || new Set(); s.add(opId); opByUser.set(uid, s); };
  const { rows: opps } = await pool.query(
    "SELECT id, preparador_id, vendedor_id, manager_preparacion_id, manager_ventas_id, supervisor_id FROM gozz.oportunidades"
  );
  for (const o of opps) {
    addOp(o.preparador_id, o.id); addOp(o.vendedor_id, o.id); addOp(o.manager_preparacion_id, o.id);
    addOp(o.manager_ventas_id, o.id); addOp(o.supervisor_id, o.id);
  }
  const ownUserFolder = new Set(all.filter((f) => f.tipo === "user").map((f) => f.owner_user_id));

  const byId = new Map(all.map((f) => [f.id, f]));
  // leadsSet = subárbol-tiene-custom (una carpeta es custom o ancestro-de-custom). Réplica del CTE `leads` del
  // backend; global aquí (para los ids bajo oportunidades la membresía coincide con la versión scopeada del backend).
  const leadsSet = new Set();
  for (const f of all) {
    if (f.tipo !== "custom") continue;
    let cur = f;
    while (cur && !leadsSet.has(cur.id)) { // se detiene al llegar a un nodo ya marcado (corta ciclos)
      leadsSet.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
  }

  // ---------- Modo --resumen: diagnóstico del conjunto solo_viejo (no-admin) ----------
  if (RESUMEN) {
    const ancestorsOf = (id) => {
      const chain = [];
      let cur = byId.get(id);
      const seen = new Set();
      while (cur) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        chain.push(cur);
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
      }
      return chain; // self → … → root
    };

    const difTipo = new Map();        // tipo de la carpeta que difiere (únicas)
    const difParentTipo = new Map();  // tipo del padre de la carpeta que difiere (por carpeta única)
    const seenFolder = new Set();
    let bajoOppNoVinc = 0, otro = 0;  // clasificación por par usuario×carpeta
    const otroEjemplos = [];
    const oppsNoVincSet = new Set();  // oportunidades no-vinculadas que el viejo hace visibles (únicas)

    let noAdmins = 0;
    for (const usr of users) {
      const isAdmin = usr.nivel === "super_admin" || usr.nivel === "admin";
      if (isAdmin) continue;
      noAdmins++;
      const opArr = [...(opByUser.get(usr.id) || [])];
      const ctx = { isAdmin: false, sub: usr.id, opSet: new Set(opArr), leadsSet };
      const oldSet = visibleFoldersOld({ sub: usr.id, nivel: usr.nivel }, all, opArr);
      const newSet = lazyWalk(ctx, root, childrenByParent);

      for (const id of oldSet) {
        if (newSet.has(id)) continue; // solo_viejo
        const f = byId.get(id);
        const chain = ancestorsOf(id);
        const oppNoVinc = chain.find((a) => a.tipo === "opportunity" && a.oportunidad_id && !ctx.opSet.has(a.oportunidad_id));
        if (oppNoVinc) { bajoOppNoVinc++; oppsNoVincSet.add(oppNoVinc.id); }
        else {
          otro++;
          if (otroEjemplos.length < 20) {
            otroEjemplos.push({ id, tipo: f && f.tipo, nombre: f && f.nombre, cadena: chain.map((a) => a.tipo).join(" < ") });
          }
        }
        if (!seenFolder.has(id)) {
          seenFolder.add(id);
          difTipo.set(f && f.tipo, (difTipo.get(f && f.tipo) || 0) + 1);
          const p = f && f.parent_id ? byId.get(f.parent_id) : null;
          const pt = p ? p.tipo : "(sin padre)";
          difParentTipo.set(pt, (difParentTipo.get(pt) || 0) + 1);
        }
      }
    }

    const orden = (m) => [...m].sort((a, b) => b[1] - a[1]);
    console.log("=== RESUMEN solo_viejo (no-admin): carpetas que visibleFolders ve y el árbol lazy NO ===");
    console.log(`Usuarios no-admin analizados: ${noAdmins} · carpetas vivas: ${all.length}`);
    console.log(`Carpetas ÚNICAS que difieren: ${seenFolder.size}`);
    console.log("\nConteo por TIPO de la carpeta que difiere:");
    for (const [t, c] of orden(difTipo)) console.log(`  ${t}: ${c}`);
    console.log("\nConteo por TIPO del PADRE de la carpeta que difiere:");
    for (const [t, c] of orden(difParentTipo)) console.log(`  ${t}: ${c}`);
    console.log("\nClasificación (por par usuario×carpeta):");
    console.log(`  bajo_oportunidad_NO_vinculada: ${bajoOppNoVinc}  (oportunidades no-vinculadas únicas implicadas: ${oppsNoVincSet.size})`);
    console.log(`  otro (NO cuelga de oportunidad no-vinculada): ${otro}`);
    console.log("\nEjemplos 'otro' (hasta 20) — id / tipo / nombre + cadena de ancestros (self → root):");
    if (otroEjemplos.length === 0) console.log("  (ninguno — todo el solo_viejo cuelga de oportunidades no-vinculadas)");
    for (const e of otroEjemplos) console.log(`  ${e.id}  tipo=${e.tipo}  nombre=${e.nombre}\n     cadena: ${e.cadena}`);
    await pool.end();
    process.exit(0);
  }

  let mismatches = 0;
  let cubiertos = { admin: 0, noOpp: 0, noDrive: 0 };
  for (const usr of users) {
    const isAdmin = usr.nivel === "super_admin" || usr.nivel === "admin";
    const opArr = [...(opByUser.get(usr.id) || [])];
    const ctx = { isAdmin, sub: usr.id, opSet: new Set(opArr), leadsSet };

    const oldSet = visibleFoldersOld({ sub: usr.id, nivel: usr.nivel }, all, opArr);
    const newSet = lazyWalk(ctx, root, childrenByParent);

    if (isAdmin) cubiertos.admin++;
    if (!isAdmin && opArr.length === 0) cubiertos.noOpp++;
    if (!ownUserFolder.has(usr.id)) cubiertos.noDrive++;

    const { onlyA, onlyB } = diff(oldSet, newSet);
    if (onlyA.length || onlyB.length) {
      mismatches++;
      console.log(`❌ DIFF  ${usr.nombre} (${usr.id}) nivel=${usr.nivel} opps=${opArr.length} viejo=${oldSet.size} nuevo=${newSet.size} · solo_viejo=${onlyA.length} solo_nuevo=${onlyB.length}`);
      if (VERBOSE) {
        for (const id of onlyA.slice(0, 20)) { const f = all.find((x) => x.id === id); console.log(`    solo_viejo: ${id} tipo=${f?.tipo} nombre=${f?.nombre}`); }
        for (const id of onlyB.slice(0, 20)) { const f = all.find((x) => x.id === id); console.log(`    solo_nuevo: ${id} tipo=${f?.tipo} nombre=${f?.nombre}`); }
      }
    }
  }

  console.log("");
  console.log(`Usuarios verificados: ${users.length}`);
  console.log(`  cobertura → admins: ${cubiertos.admin} · no-admin sin oportunidades: ${cubiertos.noOpp} · sin Mi Drive: ${cubiertos.noDrive}`);
  console.log(`Carpetas vivas: ${all.length}`);
  if (mismatches === 0) {
    console.log("✅ IGUALDAD TOTAL: el árbol lazy ve exactamente lo mismo que visibleFolders para todos los usuarios.");
  } else {
    console.log(`❌ ${mismatches} usuario(s) con diferencias. El árbol lazy NO se mergea hasta resolverlo (corré con --verbose).`);
  }
  await pool.end();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
