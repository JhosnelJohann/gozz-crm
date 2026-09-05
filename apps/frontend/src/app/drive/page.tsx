"use client";
import { AppShell } from "@/components/AppShell";
import { DriveBrowser } from "@/components/drive/DriveBrowser";

// ?papelera=papelera|cuarentena|conservado → abre el modal de papelera del Drive en esa pestaña de nivel
// (Fase B3; usado por el redirect de la ruta legacy /configuracion/archivos-sin-identificar).
export default function DrivePage({ searchParams }: { searchParams?: { papelera?: string } }) {
  const p = searchParams?.papelera;
  const trashTab = p === "conservado" ? "conservado" : p === "papelera" ? "papelera" : p === "cuarentena" ? "cuarentena" : undefined;
  return (
    <AppShell>
      <div className="h-screen px-4 py-4">
        <DriveBrowser rootScope="global" className="h-full" openTrash={!!trashTab} trashTab={trashTab} />
      </div>
    </AppShell>
  );
}
