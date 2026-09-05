import {
  File, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileCode, FileSpreadsheet,
} from "@/lib/bootstrap-icons";

// ============================================================================================
// QUE ICONO Y QUE COLOR LE TOCA A CADA TIPO DE ARCHIVO — una sola tabla para todo el proyecto
//
// Vivia dentro de `DriveBrowser.tsx`. Se saca aqui, sin cambiar una linea de su contenido, porque
// `MiniaturaArchivo` lo necesita y `DriveBrowser` necesita a `MiniaturaArchivo`: dejarlo donde
// estaba creaba un ciclo de imports entre los dos ficheros. Funcionaria —el uso es en tiempo de
// render, no de carga— pero un ciclo es de las cosas que revientan seis meses despues por un
// cambio de orden del empaquetador, y nadie relaciona la causa con el efecto.
//
// 🔴 ES LA UNICA TABLA DE ICONOS. Si hace falta el icono de un archivo en otra pantalla, se
// importa de aqui; no se escribe una segunda que se desincronice con esta.
//
// `DriveBrowser` lo re-exporta para que todo lo que ya lo importaba de alli siga funcionando.
// ============================================================================================

export interface FileVisual {
  Icon: any;
  gradient: string; // "from-XXX to-YYY"
  label: string;
}

export function fileVisual(mime: string | null, nombre: string): FileVisual {
  const ext = (nombre.split(".").pop() || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf") || ext === "pdf") return { Icon: FileText, gradient: "from-red-500 to-rose-600", label: "PDF" };
  if (m.includes("word") || ext === "doc" || ext === "docx") return { Icon: FileText, gradient: "from-blue-500 to-indigo-600", label: "DOC" };
  if (m.includes("spreadsheet") || ext === "xls" || ext === "xlsx" || ext === "csv") return { Icon: FileSpreadsheet, gradient: "from-emerald-500 to-teal-600", label: "XLS" };
  if (m.includes("presentation") || ext === "ppt" || ext === "pptx") return { Icon: FileText, gradient: "from-orange-500 to-amber-600", label: "PPT" };
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return { Icon: FileImage, gradient: "from-fuchsia-500 to-pink-600", label: "IMG" };
  if (m.startsWith("video/") || ["mp4", "mov", "avi", "webm", "mkv"].includes(ext)) return { Icon: FileVideo, gradient: "from-purple-500 to-violet-600", label: "VID" };
  if (m.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg", "flac"].includes(ext)) return { Icon: FileAudio, gradient: "from-amber-500 to-yellow-600", label: "AUD" };
  if (["zip", "rar", "tar", "gz", "7z"].includes(ext)) return { Icon: FileArchive, gradient: "from-neutral-600 to-neutral-800", label: "ZIP" };
  if (["json", "js", "ts", "tsx", "py", "sql", "html", "css", "md", "yml", "yaml"].includes(ext)) return { Icon: FileCode, gradient: "from-cyan-500 to-sky-600", label: ext.toUpperCase() };
  if (m.startsWith("text/") || ext === "txt") return { Icon: FileText, gradient: "from-neutral-500 to-neutral-700", label: "TXT" };
  return { Icon: File, gradient: "from-neutral-500 to-neutral-700", label: "FILE" };
}

export function isImage(mime: string | null, nombre: string): boolean {
  const ext = (nombre.split(".").pop() || "").toLowerCase();
  return (mime || "").startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}
