"use client";
import { useState } from "react";
import type { ContactoDetalle, ContactoInput, ContactoListItem } from "@gozz/shared-types";
import { apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { useContactosStore, type ContactosFiltros } from "../store.js";

export interface ContactosListResponse {
  items: ContactoListItem[];
  total: number;
  totalPages: number;
}

function buildQuery(filtros: ContactosFiltros, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  if (filtros.q) p.set("q", filtros.q);
  if (filtros.tramite) p.set("tramite", filtros.tramite);
  if (filtros.source) p.set("source", filtros.source);
  if (filtros.soloDuplicados) p.set("revision_dedup", "1");
  if (filtros.sinFechaNac) p.set("sin_fecha_nacimiento", "1");
  if (filtros.responsable) p.set("responsable", filtros.responsable);
  return p.toString();
}

/**
 * Wrapper del CRUD de contactos sobre `api-client`, tipado con `@gozz/shared-types`. Lee los
 * filtros del store de UI (`useContactosStore`) para construir el listado — la lista/paginación en
 * sí no se cachea aquí (eso sigue siendo estado local de quien la pide, ver `store.ts`).
 */
export function useContactos() {
  const filtros = useContactosStore((s) => s.filtros);
  const [creando, setCreando] = useState(false);
  const [actualizando, setActualizando] = useState(false);

  function listar(page: number, pageSize: number): Promise<ContactosListResponse> {
    return apiGet<ContactosListResponse>(`/api/contactos?${buildQuery(filtros, page, pageSize)}`);
  }

  async function crear(input: ContactoInput): Promise<ContactoDetalle> {
    setCreando(true);
    try {
      const { contacto } = await apiPost<{ contacto: ContactoDetalle }>("/api/contactos", input);
      return contacto;
    } finally {
      setCreando(false);
    }
  }

  async function actualizar(id: string, input: Partial<ContactoInput>): Promise<ContactoDetalle> {
    setActualizando(true);
    try {
      const { contacto } = await apiPatch<{ contacto: ContactoDetalle }>(`/api/contactos/${id}`, input);
      return contacto;
    } finally {
      setActualizando(false);
    }
  }

  return { filtros, listar, crear, creando, actualizar, actualizando };
}
