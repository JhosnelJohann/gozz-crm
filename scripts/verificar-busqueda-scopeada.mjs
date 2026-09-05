#!/usr/bin/env node
// Gate BLOQUEANTE de la Entrega 3C (búsqueda scopeada). Verifica que la búsqueda NO filtra contenido gated:
//   resultados(user, scope, q)  ==  visibleFolders(user) ∩ subárbol(scope) ∩ {nombre matchea q}
// para usuarios × scopes (incluidas las 3 COMPUERTAS root/opportunities_root/users_root) × queries, y no-admins
// sin oportunidades. Si aparece UNA sola fuga (o falta), exit 1 → no se mergea.
//
// Método: porta visibleFolders (referencia, walk desde la raíz) y el vis/mode del endpoint (walk desde el scope);
// para cada (user, scope) compara el conjunto de carpetas. Los archivos son visibles ⟺ su carpeta ∈ vis, así que
// la igualdad de conjuntos de CARPETAS garantiza también los archivos.
//
// Read-only. Correr desde el worktree de diagnóstico (/root/gozz-crm-diag), con DATABASE_URL a crm_staging:
//   node scripts/verificar-busqueda-scopeada.mjs [--verbose]

import pg from "pg";
import "dotenv/config";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL missing");
const VERBOSE = process.argv.includes("--verbose");
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---------- visibleFolders() PORTEADO (referencia; idéntico a apps/api/src/drive-routes.ts) ----------
function visibleFoldersOld(user, all, opIdsArr) {
  const isAdmin = user.nivel === "super_admin" || user.nivel === "admin";
  if (isAdmin) {
    const filtered = all.filter((f) => (f.tipo !== "user" ? true : f.owner_user_id === user.sub));
    const byId = new Map(filtered.map((f) => [f.id, f]));
    return new Set(filtered.filter((f) => {
      let cur = f; const seen = new Set();
      while (cur && cur.parent_id) { if (seen.has(cur.id)) return false; seen.add(cur.id); if (!byId.has(cur.parent_id)) return false; cur = byId.get(cur.parent_id); }
      return true;
    }).map((f) => f.id));
  }
  const opSet = new Set(opIdsArr);
  const allowed = new Set();
  const byId = new Map(all.map((f) => [f.id, f]));
  const childrenByParent = new Map();
  for (const f of all) { if (!f.parent_id) continue; const a = childrenByParent.get(f.parent_id); if (a) a.push(f); else childrenByParent.set(f.parent_id, [f]); }
  const addAnc = (id) => { let c = byId.get(id); const s = new Set(); while (c) { if (s.has(c.id)) break; s.add(c.id); allowed.add(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined; } };
  const addDesc = (id) => { const st = [id]; const s = new Set(); while (st.length) { const c = st.pop(); if (s.has(c)) continue; s.add(c); allowed.add(c); const k = childrenByParent.get(c); if (k) for (const f of k) st.push(f.id); } };
  const underForeign = (id) => { let c = byId.get(id); const s = new Set(); while (c) { if (s.has(c.id)) return false; s.add(c.id); if (c.tipo === "user") return c.owner_user_id !== user.sub; c = c.parent_id ? byId.get(c.parent_id) : undefined; } return false; };
  for (const f of all) {
    if (f.tipo === "root" || f.tipo === "users_root" || f.tipo === "opportunities_root") allowed.add(f.id);
    if (f.tipo === "company") addDesc(f.id);
    if (f.tipo === "user" && f.owner_user_id === user.sub) { addAnc(f.id); addDesc(f.id); }
    if (f.tipo === "opportunity" && f.oportunidad_id && opSet.has(f.oportunidad_id)) { addAnc(f.id); addDesc(f.id); }
    if (f.tipo === "custom" && !underForeign(f.id)) { addAnc(f.id); addDesc(f.id); }
  }
  return new Set(all.filter((f) => allowed.has(f.id)).map((f) => f.id));
}

// ---------- vis/mode del ENDPOINT PORTEADO (walk desde el scope) ----------
function childMode(parentMode, child, ctx) {
  if (child.tipo === "user" && child.owner_user_id !== ctx.sub) return null;
  switch (parentMode) {
    case "open": return "open";
    case "gate_root": return child.tipo === "company" ? "open" : child.tipo === "users_root" ? "gate_users" : child.tipo === "opportunities_root" ? "gate_opps" : "open";
    case "gate_users": return "open";
    case "gate_opps":
      if (child.tipo === "opportunity") { const linked = child.oportunidad_id != null && ctx.opSet.has(child.oportunidad_id); if (linked) return "open"; return ctx.leadsSet.has(child.id) ? "leak" : null; }
      return "open";
    case "leak": return ctx.leadsSet.has(child.id) ? (child.tipo === "custom" ? "open" : "leak") : null;
    default: return "open";
  }
}
function computeSeedModeJS(chain, ctx) {
  if (ctx.isAdmin) { if (chain.some((f) => f.tipo === "user" && f.owner_user_id !== ctx.sub)) return null; return "open"; }
  let mode = "gate_root";
  for (let i = 1; i < chain.length; i++) {
    const node = chain[i];
    if (node.tipo === "user" && node.owner_user_id !== ctx.sub) return null;
    if (mode === "open") continue;
    if (mode === "gate_root") { mode = node.tipo === "company" ? "open" : node.tipo === "users_root" ? "gate_users" : node.tipo === "opportunities_root" ? "gate_opps" : "open"; continue; }
    if (mode === "gate_users") { mode = "open"; continue; }
    if (mode === "gate_opps") { if (node.tipo === "opportunity") { const linked = node.oportunidad_id != null && ctx.opSet.has(node.oportunidad_id); if (linked) { mode = "open"; continue; } if (ctx.leadsSet.has(node.id)) { mode = "leak"; continue; } return null; } mode = "open"; continue; }
    if (mode === "leak") { if (ctx.leadsSet.has(node.id)) { mode = node.tipo === "custom" ? "open" : "leak"; continue; } return null; }
  }
  return mode;
}
function modeWalk(scopeId, seedMode, ctx, childrenByParent) {
  const set = new Set([scopeId]); const stack = [[scopeId, seedMode]]; const seen = new Set([scopeId]);
  while (stack.length) {
    const [pid, pmode] = stack.pop();
    for (const child of (childrenByParent.get(pid) || [])) {
      const m = childMode(pmode, child, ctx);
      if (m == null || seen.has(child.id)) continue;
      seen.add(child.id); set.add(child.id); stack.push([child.id, m]);
    }
  }
  return set;
}

const inter = (a, b) => { const s = new Set(); for (const x of a) if (b.has(x)) s.add(x); return s; };
const only = (a, b) => { const s = []; for (const x of a) if (!b.has(x)) s.push(x); return s; };

async function main() {
  const { rows: all } = await pool.query("SELECT id, nombre, parent_id, tipo, owner_user_id, oportunidad_id FROM gozz.drive_folders WHERE deleted_at IS NULL");
  const byId = new Map(all.map((f) => [f.id, f]));
  const childrenByParent = new Map();
  for (const f of all) { if (!f.parent_id) continue; const a = childrenByParent.get(f.parent_id); if (a) a.push(f); else childrenByParent.set(f.parent_id, [f]); }
  const leadsSet = new Set();
  for (const f of all) { if (f.tipo !== "custom") continue; let c = f; while (c && !leadsSet.has(c.id)) { leadsSet.add(c.id); c = c.parent_id ? byId.get(c.parent_id) : undefined; } }

  const { rows: users } = await pool.query("SELECT id, nombre, nivel_acceso AS nivel FROM gozz.users");
  const opByUser = new Map();
  const addOp = (uid, opId) => { if (!uid) return; const s = opByUser.get(uid) || new Set(); s.add(opId); opByUser.set(uid, s); };
  const { rows: opps } = await pool.query("SELECT id, preparador_id, vendedor_id, manager_preparacion_id, manager_ventas_id, supervisor_id FROM gozz.oportunidades");
  for (const o of opps) { addOp(o.preparador_id, o.id); addOp(o.vendedor_id, o.id); addOp(o.manager_preparacion_id, o.id); addOp(o.manager_ventas_id, o.id); addOp(o.supervisor_id, o.id); }
  const ownDrive = new Set(all.filter((f) => f.tipo === "user").map((f) => f.owner_user_id));

  const ancestorsChain = (id) => { const rev = []; let c = byId.get(id); const s = new Set(); while (c && !s.has(c.id)) { s.add(c.id); rev.push(c); c = c.parent_id ? byId.get(c.parent_id) : undefined; } return rev.reverse(); };
  const subtreeOf = (id) => { const set = new Set([id]); const st = [id]; while (st.length) { const p = st.pop(); for (const c of (childrenByParent.get(p) || [])) if (!set.has(c.id)) { set.add(c.id); st.push(c.id); } } return set; };

  // Scopes de prueba: las 3 compuertas + company + muestra de opportunity/contact/custom.
  const pick = (tipo, n) => all.filter((f) => f.tipo === tipo).slice(0, n);
  const scopes = [
    ...pick("root", 1), ...pick("opportunities_root", 1), ...pick("users_root", 1), ...pick("company", 1),
    ...pick("opportunity", 6), ...pick("contact", 4), ...pick("custom", 3),
  ].filter(Boolean);

  // Usuarios: todos los admins + muestra de no-admins asegurando edge cases (0 oportunidades, sin Mi Drive).
  const admins = users.filter((u) => u.nivel === "super_admin" || u.nivel === "admin");
  const noAdmins = users.filter((u) => !(u.nivel === "super_admin" || u.nivel === "admin"));
  const sinOpp = noAdmins.find((u) => !(opByUser.get(u.id)?.size));
  const sinDrive = noAdmins.find((u) => !ownDrive.has(u.id));
  const muestraNoAdmin = Array.from(new Set([sinOpp, sinDrive, ...noAdmins].filter(Boolean))).slice(0, 30);
  const sample = [...admins, ...muestraNoAdmin];

  const queries = ["ge", "as", "do", "19"]; // ∩ nombre (min 2 chars, como el endpoint)
  const subtreeCache = new Map();
  const subtreeCached = (id) => { let s = subtreeCache.get(id); if (!s) { s = subtreeOf(id); subtreeCache.set(id, s); } return s; };

  let leaks = 0, missings = 0, comparaciones = 0;
  for (const usr of sample) {
    const isAdmin = usr.nivel === "super_admin" || usr.nivel === "admin";
    const opArr = [...(opByUser.get(usr.id) || [])];
    const ctx = { isAdmin, sub: usr.id, opSet: new Set(opArr), leadsSet };
    const visSet = visibleFoldersOld({ sub: usr.id, nivel: usr.nivel }, all, opArr);
    for (const sc of scopes) {
      const expectedVis = inter(visSet, subtreeCached(sc.id)); // lo que la búsqueda DEBE poder devolver (carpetas)
      const seed = computeSeedModeJS(ancestorsChain(sc.id), ctx);
      const actualVis = seed ? modeWalk(sc.id, seed, ctx, childrenByParent) : new Set();
      const fuga = only(actualVis, expectedVis);   // en el resultado pero NO visible → FUGA
      const falta = only(expectedVis, actualVis);  // visible pero no devuelto → falta
      comparaciones++;
      if (fuga.length || falta.length) {
        leaks += fuga.length; missings += falta.length;
        console.log(`❌ ${usr.nombre} (${usr.nivel}) scope=${sc.tipo}:${sc.nombre} · fuga=${fuga.length} falta=${falta.length}`);
        if (VERBOSE) { for (const id of fuga.slice(0, 10)) { const f = byId.get(id); console.log(`    FUGA ${id} tipo=${f?.tipo} nombre=${f?.nombre}`); } for (const id of falta.slice(0, 10)) { const f = byId.get(id); console.log(`    falta ${id} tipo=${f?.tipo} nombre=${f?.nombre}`); } }
      } else {
        // chequeo por-query: resultados ∩ q == expected ∩ q (trivial dado set==set, pero se valida explícito)
        for (const q of queries) {
          const m = (id) => (byId.get(id)?.nombre || "").toLowerCase().includes(q);
          const aq = [...actualVis].filter(m).sort().join(",");
          const eq = [...expectedVis].filter(m).sort().join(",");
          if (aq !== eq) { leaks++; console.log(`❌ ${usr.nombre} scope=${sc.tipo}:${sc.nombre} q="${q}" difiere`); }
        }
      }
    }
  }

  console.log("");
  console.log(`Usuarios: ${sample.length} (admins ${admins.length} + no-admins muestra ${muestraNoAdmin.length}; sin_opp=${sinOpp ? "sí" : "no"} sin_drive=${sinDrive ? "sí" : "no"})`);
  console.log(`Scopes: ${scopes.map((s) => s.tipo).join(", ")} · queries: ${queries.join(", ")} · comparaciones: ${comparaciones}`);
  if (leaks === 0 && missings === 0) console.log("✅ SIN FUGAS: la búsqueda == visibleFolders ∩ subárbol(scope) ∩ {match q} para todos los casos.");
  else console.log(`❌ FUGAS=${leaks} FALTAS=${missings} — NO mergear (corré con --verbose).`);
  await pool.end();
  process.exit(leaks === 0 && missings === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
