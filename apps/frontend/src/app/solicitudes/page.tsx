"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SolicitudesList } from "@/components/solicitudes/SolicitudesList";
import { Inbox } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

// Los CUATRO estados del estándar (CONVENCIONES §10.4) + "todas". `ejecutada` está aquí porque
// desde la 0067 las vistas **no traducen**: una solicitud ejecutada llega como 'ejecutada' y sin
// este filtro no aparecería en ninguna pestaña salvo "todas".
const ESTADOS = ["pendiente", "aprobada", "ejecutada", "rechazada", "todas"];
// Filtro por tipo de solicitud. `""` = todos los tipos.
const TIPOS: { value: string; label: string }[] = [
  { value: "", label: "todos" },
  { value: "monto", label: "monto" },
  { value: "pago", label: "pago" },
  { value: "descuento", label: "descuento" },
  { value: "etapa", label: "etapa" },
];

export default function SolicitudesPage() {
  const [estado, setEstado] = useState("pendiente");
  const [tipo, setTipo] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [esAprobador, setEsAprobador] = useState(false);
  const [tiposAprobables, setTiposAprobables] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);

  const load = () => {
    setCargando(true);
    const qs = new URLSearchParams({ estado });
    if (tipo) qs.set("tipo", tipo);
    fetch(`/api/solicitudes?${qs.toString()}`).then((r) => r.json())
      .then((d) => {
        setItems(d.solicitudes || []);
        setEsAprobador(!!d.es_aprobador);
        setTiposAprobables(d.tipos_aprobables || []);
      })
      .catch(() => {}).finally(() => setCargando(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [estado, tipo]);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-brand-orange/10 text-brand-orange flex items-center justify-center"><Inbox className="h-5 w-5" /></div>
          <div>
            <h1 className="font-display text-2xl font-black">Solicitudes</h1>
            {!esAprobador && <p className="text-[11px] text-neutral-500">Aquí ves tus solicitudes y su estado.</p>}
          </div>
        </div>
        <div className="flex gap-1 mb-3 flex-wrap">
          {ESTADOS.map((e) => (
            <button key={e} onClick={() => setEstado(e)}
              className={cn("h-9 px-4 rounded-xl text-[11px] font-ui font-bold uppercase tracking-wider transition",
                estado === e ? "gradient-orange text-white shadow-glow" : "bg-white/80 text-neutral-500 hover:bg-white hover:text-neutral-700")}>
              {e}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          <span className="text-[10px] font-ui font-bold uppercase tracking-wider text-neutral-400 mr-1">Tipo:</span>
          {TIPOS.map((t) => (
            <button key={t.value} onClick={() => setTipo(t.value)}
              className={cn("h-8 px-3 rounded-lg text-[10px] font-ui font-bold uppercase tracking-wider transition",
                tipo === t.value ? "bg-brand-blue text-white shadow" : "bg-white/80 text-neutral-500 hover:bg-white hover:text-neutral-700")}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="glass rounded-3xl p-5">
          {cargando
            ? <div className="text-center py-10 text-neutral-400 text-sm">Cargando…</div>
            : <SolicitudesList solicitudes={items} onChange={load} showOportunidad puedeAprobar={esAprobador} tiposAprobables={tiposAprobables} />}
        </div>
      </div>
    </AppShell>
  );
}
