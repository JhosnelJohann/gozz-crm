"use client";
import { useEffect, useState } from "react";

export interface PipelineStage {
  id: string;
  key: string;
  label: string;
  color: string;
  orden: number;
  es_terminal: boolean;
  es_ganado: boolean;
  campos_obligatorios: string[];
  activa: boolean;
}

export interface StageAutomation {
  id: string;
  tipo: "crear_tarea" | "enviar_webhook" | "notificar" | "enviar_email" | "asignar_preparador" | "mover_tras_dias";
  config: Record<string, any>;
  activa: boolean;
  orden: number;
}

let _cache: { stages: PipelineStage[]; ts: number } | null = null;
const TTL_MS = 60_000;

export async function fetchStages(force = false): Promise<PipelineStage[]> {
  if (!force && _cache && Date.now() - _cache.ts < TTL_MS) return _cache.stages;
  const r = await fetch("/api/pipeline/stages", { cache: "no-store" });
  const d = await r.json();
  const stages: PipelineStage[] = d.stages || [];
  _cache = { stages, ts: Date.now() };
  return stages;
}

export function invalidateStagesCache() { _cache = null; }

export function useStages() {
  const [stages, setStages] = useState<PipelineStage[] | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    fetchStages()
      .then((s) => { if (mounted) { setStages(s); setLoading(false); } })
      .catch(() => { if (mounted) { setStages([]); setLoading(false); } });
    return () => { mounted = false; };
  }, []);
  return { stages, loading, reload: async () => { invalidateStagesCache(); const s = await fetchStages(true); setStages(s); } };
}

export const CAMPOS_OBLIGATORIOS_DISPONIBLES = [
  { key: "contacto_id", label: "Contacto vinculado" },
  { key: "tipo_tramite_id", label: "Trámite seleccionado" },
  { key: "preparador_id", label: "Preparador asignado" },
  { key: "vendedor_id", label: "Vendedor asignado" },
  { key: "valor_total", label: "Valor total > 0" },
  { key: "sla_fecha_limite", label: "Fecha límite SLA" },
  { key: "cuestionario_firmado", label: "Cuestionario firmado" },
];
