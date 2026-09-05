"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, UserPlus, X, Shield, Sparkles, Circle, Mail } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  email: string;
  nombre: string;
  nivel_acceso: string;
  posiciones: string[];
  activo: boolean;
  online: boolean;
  ultimo_login: string | null;
  foto_perfil_url?: string | null;
}

const POSICIONES = [
  "Manager General", "Manager de Preparación", "Manager de Ventas", "Manager de Taxes",
  "Preparador de Inmigración", "Preparador de Taxes", "Closer", "Setter", "Post-venta", "Supervisor"
];

const NIVEL_COLORS: Record<string, string> = {
  super_admin: "text-brand-orange bg-brand-orange/10",
  admin: "text-brand-blue bg-blue-100",
  usuario: "text-neutral-600 bg-neutral-100"
};

export default function UsuariosPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ email: "", nombre: "", password: "", nivel_acceso: "usuario", posiciones: [] as string[] });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const r = await fetch("/api/users");
    const d = await r.json();
    setUsers(d.users || []);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.email || !form.nombre || !form.password) { toast.error("Email, nombre y password requeridos"); return; }
    if (form.password.length < 8) { toast.error("Password mínimo 8 caracteres"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Error");
      toast.success("Usuario creado");
      setModal(false);
      setForm({ email: "", nombre: "", password: "", nivel_acceso: "usuario", posiciones: [] });
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Admin
            </div>
            <h1 className="font-display text-4xl font-black leading-tight">
              <span className="text-gradient-orange">Usuarios</span> del equipo
            </h1>
            <p className="mt-2 text-neutral-500">{users ? `${users.length} usuarios` : "Cargando..."}</p>
          </div>
          <button onClick={() => setModal(true)} className="gradient-orange flex items-center gap-2 h-11 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow hover:scale-[1.02] transition">
            <UserPlus className="h-4 w-4" strokeWidth={2} />
            Añadir usuario
          </button>
        </motion.div>

        <div className="space-y-2">
          {users === null
            ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="glass rounded-2xl h-20 skeleton" />)
            : users.map((u, i) => {
                const initials = u.nombre.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
                return (
                  <motion.a
                    key={u.id}
                    href={`/equipo/${u.id}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i }}
                    className="glass rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-brand-orange/40 border border-transparent transition cursor-pointer"
                  >
                    <div className="relative">
                      <div className="h-12 w-12 rounded-xl overflow-hidden bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-white font-ui font-bold text-sm">
                        {u.foto_perfil_url ? <img src={u.foto_perfil_url} alt={u.nombre} className="h-full w-full object-cover" /> : initials}
                      </div>
                      <Circle className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 stroke-white fill-current", u.online ? "text-brand-green" : "text-neutral-400")} strokeWidth={3} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-display font-black text-base truncate">{u.nombre}</div>
                        {u.nivel_acceso === "super_admin" && <Shield className="h-4 w-4 text-brand-orange" strokeWidth={2} />}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <Mail className="h-3 w-3" strokeWidth={1.5} />
                        <span className="truncate">{u.email}</span>
                      </div>
                      {u.posiciones && u.posiciones.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {u.posiciones.map((p) => (
                            <span key={p} className="text-[9px] font-ui uppercase tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">{p}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn("px-2.5 py-1 rounded-full text-[9px] font-ui uppercase tracking-wider font-bold", NIVEL_COLORS[u.nivel_acceso] || NIVEL_COLORS.usuario)}>
                        {u.nivel_acceso}
                      </span>
                      {!u.activo && (
                        <span className="px-2 py-0.5 rounded-full text-[9px] font-ui uppercase bg-neutral-200 text-neutral-500">Inactivo</span>
                      )}
                    </div>
                  </motion.a>
                );
              })}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(false)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-3xl p-8 max-w-md w-full max-h-[90vh] overflow-y-auto scrollbar-thin modal-surface"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-2xl font-black">Nuevo usuario</h2>
                <button onClick={() => setModal(false)} className="h-9 w-9 rounded-xl hover:bg-black/5 flex items-center justify-center">
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <div className="space-y-4">
                {[
                  { k: "nombre", label: "Nombre completo", type: "text", ph: "María García" },
                  { k: "email", label: "Email", type: "email", ph: "maria@tuagente..." },
                  { k: "password", label: "Password temporal", type: "text", ph: "8+ caracteres" }
                ].map((f) => (
                  <div key={f.k}>
                    <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">{f.label} *</label>
                    <input
                      type={f.type}
                      value={(form as any)[f.k]}
                      onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                      placeholder={f.ph}
                      className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                    />
                  </div>
                ))}
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Nivel de acceso</label>
                  <select value={form.nivel_acceso} onChange={(e) => setForm({ ...form, nivel_acceso: e.target.value })} className="w-full h-11 px-4 rounded-xl bg-white border border-black/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30">
                    <option value="usuario">Usuario</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1.5">Posiciones</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {POSICIONES.map((p) => (
                      <label key={p} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.posiciones.includes(p)}
                          onChange={(e) => setForm({ ...form, posiciones: e.target.checked ? [...form.posiciones, p] : form.posiciones.filter((x) => x !== p) })}
                          className="h-3.5 w-3.5 accent-brand-orange"
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setModal(false)} className="flex-1 h-11 rounded-xl bg-white border border-black/10 font-ui text-xs font-bold uppercase tracking-wider hover:bg-black/5">Cancelar</button>
                <button onClick={save} disabled={saving} className="flex-1 gradient-orange h-11 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-glow disabled:opacity-60">
                  {saving ? "Creando…" : "Crear"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
