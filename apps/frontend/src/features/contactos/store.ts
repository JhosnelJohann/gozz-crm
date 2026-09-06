// Estado de UI/cliente del slice de contactos: filtros de búsqueda y qué modal está abierto.
// Los datos de servidor (la página de resultados, el total, los facets) NO viven aquí — eso sigue
// siendo estado local del componente que los pide, para no reinventar un caché de servidor.
import { create } from "zustand";

export type ContactosVista = "mosaico" | "lista";

export interface ContactosFiltros {
  q: string;
  tramite: string;
  /** Candidatos a duplicado que el motor de dedup dejó marcados esperando revisión humana. */
  soloDuplicados: boolean;
  sinFechaNac: boolean;
  /** uuid del responsable, `"sin_responsable"`, o `""` = sin filtrar. */
  responsable: string;
}

interface ContactosUiState {
  filtros: ContactosFiltros;
  setFiltro: <K extends keyof ContactosFiltros>(campo: K, valor: ContactosFiltros[K]) => void;
  resetFiltros: () => void;

  vista: ContactosVista;
  setVista: (v: ContactosVista) => void;

  modalCrear: boolean;
  setModalCrear: (v: boolean) => void;
  confirmarArchivado: boolean;
  setConfirmarArchivado: (v: boolean) => void;
  fusionAbierta: boolean;
  setFusionAbierta: (v: boolean) => void;
  papeleraAbierta: boolean;
  setPapeleraAbierta: (v: boolean) => void;
  responsableAbierto: boolean;
  setResponsableAbierto: (v: boolean) => void;
  tareaMasivaAbierta: boolean;
  setTareaMasivaAbierta: (v: boolean) => void;
}

const FILTROS_INICIALES: ContactosFiltros = {
  q: "",
  tramite: "",
  soloDuplicados: false,
  sinFechaNac: false,
  responsable: "",
};

export const useContactosStore = create<ContactosUiState>((set) => ({
  filtros: FILTROS_INICIALES,
  setFiltro: (campo, valor) => set((s) => ({ filtros: { ...s.filtros, [campo]: valor } })),
  resetFiltros: () => set({ filtros: FILTROS_INICIALES }),

  vista: "mosaico",
  setVista: (vista) => set({ vista }),

  modalCrear: false,
  setModalCrear: (modalCrear) => set({ modalCrear }),
  confirmarArchivado: false,
  setConfirmarArchivado: (confirmarArchivado) => set({ confirmarArchivado }),
  fusionAbierta: false,
  setFusionAbierta: (fusionAbierta) => set({ fusionAbierta }),
  papeleraAbierta: false,
  setPapeleraAbierta: (papeleraAbierta) => set({ papeleraAbierta }),
  responsableAbierto: false,
  setResponsableAbierto: (responsableAbierto) => set({ responsableAbierto }),
  tareaMasivaAbierta: false,
  setTareaMasivaAbierta: (tareaMasivaAbierta) => set({ tareaMasivaAbierta }),
}));
