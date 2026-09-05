// Fase B3: la papelera se unificó en el modal del Drive. Esta ruta legacy (bookmarks viejos) redirige al Drive
// abriendo el modal en la pestaña "Sin identificar" (cuarentena). Ver components/drive/SinIdentificarPanel.tsx.
import { redirect } from "next/navigation";

export default function ArchivosSinIdentificarPage() {
  redirect("/drive?papelera=cuarentena");
}
