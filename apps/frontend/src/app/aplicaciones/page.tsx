"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowSquareOut, CircleDashed, GraduationCap, Users, X, Sparkle, WarningCircle } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";

interface AppEntry {
  key: "ciudadania" | "academia";
  name: string;
  description: string;
  color: string;
  base_url: string;
  online: boolean;
  kpis: Record<string, number | string>;
}

export default function AplicacionesPage() {
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [denyMsg, setDenyMsg] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/aplicaciones/status");
      if (!r.ok) {
        toast.error("Error cargando aplicaciones");
        setApps([]);
        return;
      }
      const d = await r.json();
      setApps(d.apps || []);
    } catch {
      setApps([]);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, [loadStatus]);

  const openApp = async (appKey: string) => {
    if (opening) return;
    setOpening(appKey);
    try {
      const r = await fetch("/api/aplicaciones/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app: appKey }),
      });
      const d = await r.json();
      if (r.ok && d.url) {
        window.open(d.url, "_blank", "noopener,noreferrer");
      } else if (r.status === 403) {
        setDenyMsg(d.message || "No tenés acceso a esta aplicación.");
      } else {
        toast.error(d.error || "Error generando acceso SSO");
      }
    } catch {
      toast.error("Error de red");
    } finally {
      setOpening(null);
    }
  };

  const iconFor = (key: string) =>
    key === "academia" ? GraduationCap : Users;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-wider mb-3">
            <Sparkle className="h-3.5 w-3.5" />
            Hub
          </div>
          <h1 className="font-display text-4xl font-black leading-tight">
            <span className="text-gradient-orange">Aplicaciones</span> conectadas
          </h1>
          <p className="mt-2 text-neutral-500">
            Acceso unificado a las apps internas. Click en abrir → entrás como admin si tenés permisos.
          </p>
        </motion.div>

        {apps === null && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[0, 1].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-neutral-100 animate-pulse" />
            ))}
          </div>
        )}

        {apps && apps.length === 0 && (
          <div className="text-center py-16 text-neutral-400">
            <CircleDashed className="h-12 w-12 mx-auto mb-3" />
            <p>No hay aplicaciones disponibles.</p>
          </div>
        )}

        {apps && apps.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {apps.map((app, idx) => {
              const Icon = iconFor(app.key);
              const isOpening = opening === app.key;
              return (
                <motion.div
                  key={app.key}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + idx * 0.08 }}
                  className="relative bg-white border border-neutral-200 rounded-2xl p-6 hover:shadow-lg transition-shadow group"
                >
                  {/* status pill */}
                  <div className="absolute top-4 right-4 flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        app.online ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                      }`}
                    />
                    <span className="text-[10px] uppercase font-ui tracking-wider text-neutral-500">
                      {app.online ? "Online" : "Offline"}
                    </span>
                  </div>

                  {/* icon + name */}
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      className="h-14 w-14 rounded-xl flex items-center justify-center"
                      style={{ background: app.color + "1A", color: app.color }}
                    >
                      <Icon className="h-7 w-7" />
                    </div>
                    <div className="flex-1 pt-1">
                      <h2 className="font-display text-2xl font-black leading-tight text-neutral-900">
                        {app.name}
                      </h2>
                      <p className="text-sm text-neutral-500 mt-0.5">{app.description}</p>
                    </div>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                    {Object.entries(app.kpis).map(([k, v]) => (
                      <div
                        key={k}
                        className="bg-neutral-50 border border-neutral-100 rounded-lg p-3"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-ui">
                          {k.replace(/_/g, " ")}
                        </p>
                        <p className="text-2xl font-display font-black text-neutral-900 tabular-nums">
                          {v}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openApp(app.key)}
                      disabled={isOpening || !app.online}
                      className="flex-1 flex items-center justify-center gap-2 h-11 px-5 rounded-xl font-ui text-xs font-bold uppercase tracking-wider text-white shadow-md hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed transition"
                      style={{
                        background: `linear-gradient(135deg, ${app.color}, ${app.color}cc)`,
                      }}
                    >
                      {isOpening ? (
                        <>
                          <CircleDashed className="h-4 w-4 animate-spin" /> Generando acceso...
                        </>
                      ) : (
                        <>
                          <ArrowSquareOut className="h-4 w-4" /> Abrir aplicación
                        </>
                      )}
                    </button>
                    <a
                      href={app.base_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-neutral-400 hover:text-neutral-700 px-3 py-2"
                      title="Abrir URL pública (sin SSO)"
                    >
                      ↗
                    </a>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* No-access modal */}
      <AnimatePresence>
        {denyMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => setDenyMsg(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <WarningCircle className="h-7 w-7 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-xl font-black text-neutral-900">
                    Sin acceso
                  </h3>
                  <p className="text-sm text-neutral-600 mt-1">{denyMsg}</p>
                </div>
                <button onClick={() => setDenyMsg(null)} className="text-neutral-400 hover:text-neutral-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <button
                onClick={() => setDenyMsg(null)}
                className="w-full h-11 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-ui font-bold uppercase tracking-wider rounded-xl"
              >
                Entendido
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
