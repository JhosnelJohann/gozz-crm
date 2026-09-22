let activeConversacionId: string | null = null;

export function setWhatsappActive(id: string | null) {
  activeConversacionId = id;
}

export function getWhatsappActive(): string | null {
  return activeConversacionId;
}
