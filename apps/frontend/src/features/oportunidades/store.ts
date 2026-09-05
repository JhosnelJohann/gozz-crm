// Estado de UI/cliente del slice de oportunidades: filtros semánticos del pipeline y qué modal
// está abierto. El tablero/lista en sí (columnas, conteos, páginas) sigue siendo estado local del
// componente que los pide — el filtrado y los conteos son siempre del servidor (ver
// `app/oportunidades/page.tsx`), esto solo guarda CON QUÉ filtro se pidieron.
import { create } from "zustand";

export type CampoFecha = "created_at" | "fecha_completada";
export type OportunidadesVista = "tablero" | "lista";

export interface OportunidadesFiltros {
  asignado: string;
  tramite: string;
  sla: string;
  q: string;
  soloMios: boolean;
  /** Rango en ISO — nunca `Date` (estos filtros son serializables). */
  desde: string;
  hasta: string;
  campoFecha: CampoFecha;
}

export const FILTROS_VACIOS: OportunidadesFiltros = {
  asignado: "", tramite: "", sla: "", q: "", soloMios: false,
  desde: "", hasta: "", campoFecha: "created_at",
};

interface OportunidadesUiState {
  filtros: OportunidadesFiltros;
  setFiltros: (f: OportunidadesFiltros) => void;
  setFiltro: <K extends keyof OportunidadesFiltros>(campo: K, valor: OportunidadesFiltros[K]) => void;
  resetFiltros: () => void;

  vista: OportunidadesVista;
  setVista: (v: OportunidadesVista) => void;
  etapaLista: string;
  setEtapaLista: (e: string) => void;

  modalCrear: boolean;
  setModalCrear: (v: boolean) => void;
  cambioEtapaAbierto: boolean;
  setCambioEtapaAbierto: (v: boolean) => void;
  exportarAbierto: boolean;
  setExportarAbierto: (v: boolean) => void;
}

export const useOportunidadesStore = create<OportunidadesUiState>((set) => ({
  filtros: FILTROS_VACIOS,
  setFiltros: (filtros) => set({ filtros }),
  setFiltro: (campo, valor) => set((s) => ({ filtros: { ...s.filtros, [campo]: valor } })),
  resetFiltros: () => set({ filtros: FILTROS_VACIOS }),

  vista: "tablero",
  setVista: (vista) => set({ vista }),
  etapaLista: "",
  setEtapaLista: (etapaLista) => set({ etapaLista }),

  modalCrear: false,
  setModalCrear: (modalCrear) => set({ modalCrear }),
  cambioEtapaAbierto: false,
  setCambioEtapaAbierto: (cambioEtapaAbierto) => set({ cambioEtapaAbierto }),
  exportarAbierto: false,
  setExportarAbierto: (exportarAbierto) => set({ exportarAbierto }),
}));
