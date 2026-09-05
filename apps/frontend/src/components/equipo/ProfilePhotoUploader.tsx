"use client";
import { useRef, useState } from "react";
import { Camera, Loader2 } from "@/lib/bootstrap-icons";
import { toast } from "sonner";

interface Props {
  userId: string;
  onUploaded: (url: string) => void;
  currentUrl?: string | null;
  nombre: string;
  isOwner?: boolean;
}

export function ProfilePhotoUploader({ userId, onUploaded, isOwner }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Solo imagenes"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Maximo 5MB"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("foto", file);
      const url = isOwner ? "/api/users/me/foto" : `/api/admin/users/${userId}/foto`;
      const r = await fetch(url, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload fallo");
      toast.success("Foto actualizada");
      onUploaded(d.foto_perfil_url);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="absolute bottom-2 right-2 h-11 w-11 rounded-full bg-gradient-to-br from-brand-orange to-neon-magenta flex items-center justify-center shadow-xl hover:scale-110 transition z-10 border-4 border-[#0A0A12]"
        title="Cambiar foto"
      >
        {uploading ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Camera className="h-4 w-4 text-white" strokeWidth={2.5} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </>
  );
}
