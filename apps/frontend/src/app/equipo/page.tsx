"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Users, Sparkles, Loader2, Mail, Search, Briefcase, LayoutGrid, Network } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { initialsOf } from "@/lib/auth-user";

interface TeamUser {
  id: string;
  email: string;
  nombre: string;
  nivel_acceso: string;
  posiciones: string[];
  foto_perfil_url: string | null;
  online: boolean;
  departamento?: string | null;
}

export default function EquipoPage() {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((d) => setUsers(d.users || []));
  }, []);

  const filtered = users?.filter((u) =>
    !q || u.nombre.toLowerCase().includes(q.toLowerCase()) ||
    u.email.toLowerCase().includes(q.toLowerCase()) ||
    (u.departamento || "").toLowerCase().includes(q.toLowerCase())
  ) || [];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="relative mb-8 rounded-3xl overflow-hidden glass p-8 border border-white/10">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-brand-orange/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-neon-magenta/10 rounded-full blur-3xl" />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.2em] mb-2">
                <Sparkles className="h-3 w-3" strokeWidth={1.5} />
                Equipo GOZZ
              </div>
              <h1 className="font-display text-4xl font-black mb-2">Directorio del equipo</h1>
              <p className="text-sm text-neutral-500 max-w-lg">
                Perfiles, contactos y roles del equipo.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/equipo" className="h-11 px-4 rounded-xl bg-white text-neutral-900 shadow-sm font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 border border-neutral-200">
                <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
                Directorio
              </Link>
              <Link href="/equipo/organigrama" className="h-11 px-4 rounded-xl bg-brand-orange/10 text-brand-orange font-ui text-[11px] font-bold uppercase tracking-wider hover:bg-brand-orange hover:text-white transition-colors flex items-center gap-2">
                <Network className="h-3.5 w-3.5" strokeWidth={2} />
                Organigrama
              </Link>
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 h-11 min-w-[240px]">
                <Search className="h-4 w-4 text-white/40" />
                <input
                  placeholder="Buscar por nombre, email, departamento..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {users === null ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-brand-orange animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((u, i) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link href={`/equipo/${u.id}`} className="block glass rounded-3xl p-5 border border-white/10 hover:border-brand-orange/40 transition group relative overflow-hidden">
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-br from-brand-orange/5 to-neon-magenta/5" />
                  <div className="relative flex flex-col items-center text-center">
                    <div className="relative mb-4">
                      <div className="h-24 w-24 rounded-full overflow-hidden border-4 border-transparent bg-gradient-to-br from-brand-orange to-neon-magenta p-[3px]">
                        <div className="h-full w-full rounded-full overflow-hidden bg-zinc-900 flex items-center justify-center">
                          {u.foto_perfil_url ? (
                            <img src={u.foto_perfil_url} alt={u.nombre} className="w-full h-full object-cover" />
                          ) : (
                            <div className="h-full w-full bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center text-2xl font-display font-black text-white">
                              {initialsOf(u.nombre)}
                            </div>
                          )}
                        </div>
                      </div>
                      {u.online && (
                        <div className="absolute bottom-1 right-1 h-5 w-5 rounded-full bg-green-400 border-2 border-[#0A0A12] animate-pulse" />
                      )}
                    </div>
                    <div className="font-display font-black text-base mb-1 truncate max-w-full">{u.nombre}</div>
                    <div className="flex items-center gap-1 text-[11px] text-white/50 font-ui mb-2 truncate max-w-full">
                      <Mail className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{u.email}</span>
                    </div>
                    {((u.posiciones || [])[0] || u.departamento) ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-ui uppercase tracking-[0.15em] font-bold bg-gradient-to-r from-brand-orange to-neon-magenta text-white shadow max-w-full truncate">
                        <Briefcase className="h-2.5 w-2.5 flex-shrink-0" strokeWidth={2.5} />
                        <span className="truncate">{(u.posiciones || [])[0] || u.departamento}</span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-white/40 font-ui uppercase tracking-wider">Miembro del equipo</div>
                    )}
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
