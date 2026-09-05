let activeGrupoId: string | null = null;

export function setActiveChat(id: string | null) {
  activeGrupoId = id;
}

export function getActiveChat(): string | null {
  return activeGrupoId;
}
