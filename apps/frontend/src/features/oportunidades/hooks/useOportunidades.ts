"use client";
import { useState } from "react";
import type { Oportunidad, OportunidadInput } from "@gozz/shared-types";
import { apiDelete, apiPatch, apiPost } from "@/lib/api-client";

/** Wrapper del CRUD de oportunidades sobre `api-client`, tipado con `@gozz/shared-types`. */
export function useOportunidades() {
  const [creando, setCreando] = useState(false);
  const [actualizando, setActualizando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  async function crear(input: OportunidadInput): Promise<Oportunidad> {
    setCreando(true);
    try {
      const { oportunidad } = await apiPost<{ oportunidad: Oportunidad }>("/api/oportunidades", input);
      return oportunidad;
    } finally {
      setCreando(false);
    }
  }

  async function actualizar(id: string, input: Partial<OportunidadInput>): Promise<Oportunidad> {
    setActualizando(true);
    try {
      const { oportunidad } = await apiPatch<{ oportunidad: Oportunidad }>(`/api/oportunidades/${id}`, input);
      return oportunidad;
    } finally {
      setActualizando(false);
    }
  }

  async function eliminar(id: string): Promise<void> {
    setEliminando(true);
    try {
      await apiDelete<{ ok: true }>(`/api/oportunidades/${id}`);
    } finally {
      setEliminando(false);
    }
  }

  return { crear, creando, actualizar, actualizando, eliminar, eliminando };
}
