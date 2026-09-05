"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, Trophy, DollarSign, Users, Plus, Trash2, Sparkles, Pencil, Check, X, Lock, TrendingUp } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useCurrentUser, initialsOf } from "@/lib/auth-user";

interface UsuarioRow {
  id: string;
  nombre: string;
  foto_perfil_url: string | null;
  cargo_codigo: string | null;
  cargo_nombre: string | null;
  cargo_valor_punto: string | null;
  puntos_total: string;
  usd_total: string;
  registros: number;
}
interface Cargo {
  id: string;
  codigo: string;
  nombre: string;
  valor_punto_usd: string;
}

// Cargos que participan en los puntajes (los demas no se muestran aqui)
const PUNTAJE_CARGOS = ["vendedor", "preparador", "gerente_ventas", "gerente_preparacion", "manager_general"];

export default function PuntajesConfigPage() {
  const { isAdmin } = useCurrentUser();
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editCargo, setEditCargo] = useState<{ id: string; valor: string } | null>(null);
  const [bonoOpen, setBonoOpen] = useState<UsuarioRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/equipo/puntajes-resumen");
      const d = await r.json();
      setUsuarios(d.usuarios || []);
      setCargos(d.cargos || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totales = useMemo(() => ({
    puntos: usuarios.reduce((s, u) => s + Number(u.puntos_total || 0), 0),
    usd: usuarios.reduce((s, u) => s + Number(u.usd_total || 0), 0),
    activos: usuarios.length,
    conPuntos: usuarios.filter((u) => Number(u.puntos_total || 0) > 0).length,
  }), [usuarios]);

  const saveCargo = async (cargoId: string, valor: number) => {
    try {
      const r = await fetch(`/api/equipo/cargos/${cargoId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor_punto_usd: valor })
      });
      if (!r.ok) throw new Error();
      toast.success("Valor del punto actualizado");
      setEditCargo(null);
      load();
    } catch { toast.error("Error"); }
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Link href="/configuracion" className="inline-flex items-center gap-1.5 text-[11px] font-ui font-bold uppercase tracking-wider text-neutral-500 hover:text-brand-orange mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Configuración
        </Link>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-2">
            <Sparkles className="h-3.5 w-3.5" /> Admin
          </div>
          <h1 className="font-display text-4xl font-black leading-tight">
            <span className="text-gradient-orange">Puntajes del equipo</span>
          </h1>
          <p className="mt-2 text-neutral-500 text-sm">Ver y editar puntos, valor por cargo y bonos manuales</p>
          {!isAdmin && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-ui text-neutral-400 bg-neutral-100 px-2 py-1 rounded-lg">
              <Lock className="h-3 w-3" /> Solo admin puede editar
            </div>
          )}
        </motion.div>

        {loading ? (
          <div className="text-center py-16 text-neutral-400 text-sm">Cargando…</div>
        ) : (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Equipo activo" value={String(totales.activos)} icon={Users} color="#2196C9" />
              <Stat label="Con puntos" value={String(totales.conPuntos)} icon={Trophy} color="#43A847" />
              <Stat label="Puntos totales" value={totales.puntos.toFixed(2)} icon={TrendingUp} color="#5750E8" />
              <Stat label="USD acumulados" value={`$${totales.usd.toFixed(2)}`} icon={DollarSign} color="#43A847" />
            </div>

            {/* Cargos editables */}
            <div className="bg-white rounded-2xl border border-neutral-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-black text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-brand-orange" /> Valor del punto por cargo
                </h2>
                {!isAdmin && <span className="text-[10px] text-neutral-400">Solo lectura</span>}
              </div>
              {cargos.length === 0 ? (
                <p className="text-sm text-neutral-400">Sin cargos configurados.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {cargos.filter((c) => PUNTAJE_CARGOS.includes(c.codigo)).map((c) => {
                    const editing = editCargo?.id === c.id;
                    return (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-neutral-50 border border-neutral-100">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold truncate">{c.nombre}</div>
                          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{c.codigo}</div>
                        </div>
                        {editing ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-neutral-500">$</span>
                            <input
                              type="number"
                              step="0.01"
                              value={editCargo!.valor}
                              onChange={(e) => setEditCargo({ ...editCargo!, valor: e.target.value })}
                              className="w-20 h-7 px-2 rounded border border-neutral-200 text-xs outline-none focus:border-brand-orange"
                              autoFocus
                            />
                            <button onClick={() => saveCargo(c.id, Number(editCargo!.valor))} className="h-7 w-7 rounded bg-emerald-500 text-white flex items-center justify-center"><Check className="h-3 w-3" /></button>
                            <button onClick={() => setEditCargo(null)} className="h-7 w-7 rounded bg-neutral-300 text-neutral-700 flex items-center justify-center"><X className="h-3 w-3" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-display font-black text-base text-brand-green tabular-nums">${Number(c.valor_punto_usd).toFixed(2)}</span>
                            {isAdmin && (
                              <button onClick={() => setEditCargo({ id: c.id, valor: String(c.valor_punto_usd) })} className="h-7 w-7 rounded hover:bg-neutral-200 text-neutral-500 flex items-center justify-center" title="Editar">
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tabla usuarios */}
            <div className="bg-white rounded-2xl border border-neutral-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
                <h2 className="font-display font-black text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-orange" /> Puntajes por usuario ({usuarios.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50/50">
                    <tr className="text-[10px] uppercase tracking-wider text-neutral-500 font-ui">
                      <th className="text-left px-4 py-2.5">Usuario</th>
                      <th className="text-left px-4 py-2.5">Cargo</th>
                      <th className="text-right px-4 py-2.5">Valor punto</th>
                      <th className="text-right px-4 py-2.5">Puntos</th>
                      <th className="text-right px-4 py-2.5">USD</th>
                      <th className="text-right px-4 py-2.5">Registros</th>
                      <th className="text-right px-4 py-2.5">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {usuarios.map((u) => (
                      <tr key={u.id} className="hover:bg-neutral-50/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {u.foto_perfil_url
                              ? <img src={u.foto_perfil_url} className="h-7 w-7 rounded-full object-cover" alt="" />
                              : <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[10px] font-bold flex items-center justify-center">{initialsOf(u.nombre)}</div>}
                            <span className="font-semibold">{u.nombre}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {u.cargo_nombre ? (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold uppercase">{u.cargo_nombre}</span>
                          ) : <span className="text-neutral-400 text-[10px]">— sin cargo —</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs tabular-nums text-neutral-500">
                          {u.cargo_valor_punto ? `$${Number(u.cargo_valor_punto).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold">{Number(u.puntos_total).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-600">${Number(u.usd_total).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-neutral-500">{u.registros}</td>
                        <td className="px-4 py-2.5 text-right">
                          {isAdmin ? (
                            <button onClick={() => setBonoOpen(u)} className="h-7 px-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ml-auto">
                              <Plus className="h-3 w-3" /> Bono
                            </button>
                          ) : <span className="text-[10px] text-neutral-400">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {bonoOpen && <BonoModal user={bonoOpen} onClose={() => setBonoOpen(null)} onSaved={() => { setBonoOpen(null); load(); }} />}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, icon: Icon, color }: any) {
  return (
    <motion.div whileHover={{ y: -2 }} className="bg-white rounded-2xl border border-neutral-100 p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: color + "15", color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[10px] font-ui uppercase tracking-wider text-neutral-500">{label}</div>
        <div className="text-2xl font-black font-display leading-none mt-0.5" style={{ color }}>{value}</div>
      </div>
    </motion.div>
  );
}

function BonoModal({ user, onClose, onSaved }: any) {
  const [puntos, setPuntos] = useState("");
  const [valor, setValor] = useState(user.cargo_valor_punto || "1");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!puntos || Number(puntos) === 0) { toast.error("Ingresá puntos"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/equipo/puntajes/bono", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          puntos: Number(puntos),
          valor_punto_usd: Number(valor) || 1,
          motivo: motivo.trim() || "bono_manual"
        })
      });
      if (!r.ok) throw new Error();
      toast.success(`Bono de ${puntos} pts agregado a ${user.nombre}`);
      onSaved();
    } catch { toast.error("Error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-black text-lg">Bono manual</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-neutral-400" /></button>
        </div>
        <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-neutral-50">
          {user.foto_perfil_url
            ? <img src={user.foto_perfil_url} className="h-10 w-10 rounded-full object-cover" alt="" />
            : <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white font-bold flex items-center justify-center">{initialsOf(user.nombre)}</div>}
          <div>
            <div className="text-sm font-bold">{user.nombre}</div>
            <div className="text-xs text-neutral-500">{user.cargo_nombre || "Sin cargo"} · ${Number(user.usd_total).toFixed(2)} acumulado</div>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Puntos a otorgar</label>
            <input
              type="number"
              step="0.01"
              autoFocus
              value={puntos}
              onChange={(e) => setPuntos(e.target.value)}
              placeholder="ej. 5"
              className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
            />
            <p className="text-[10px] text-neutral-400 mt-1">Negativos para descuentos</p>
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Valor del punto (USD)</label>
            <input
              type="number"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
            />
          </div>
          <div>
            <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Motivo (opcional)</label>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="ej. Premio mejor cierre del mes"
              className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
            />
          </div>
          {puntos && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
              <span className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">Total a sumar</span>
              <div className="font-display text-2xl font-black text-emerald-700">${(Number(puntos) * Number(valor || 1)).toFixed(2)}</div>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-neutral-200 text-xs font-ui font-bold uppercase tracking-wider hover:bg-neutral-50">Cancelar</button>
          <button onClick={save} disabled={saving} className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Guardando..." : "Otorgar bono"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
