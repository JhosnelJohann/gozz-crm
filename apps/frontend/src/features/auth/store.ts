// Estado de UI del slice de auth. Solo lo que es del CLIENTE (qué modal está abierto) — el
// usuario autenticado en sí sigue viviendo en `lib/auth-user.ts` (`useCurrentUser`), que ya cachea
// la respuesta de `GET /api/auth/me` para toda la app; duplicarlo aquí sería otro caché del mismo
// dato, no estado de UI.
import { create } from "zustand";

interface AuthUiState {
  resetModalOpen: boolean;
  openResetModal: () => void;
  closeResetModal: () => void;
}

export const useAuthUiStore = create<AuthUiState>((set) => ({
  resetModalOpen: false,
  openResetModal: () => set({ resetModalOpen: true }),
  closeResetModal: () => set({ resetModalOpen: false }),
}));
