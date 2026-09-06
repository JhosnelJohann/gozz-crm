// Adaptador de AuthenticationState de Baileys respaldado en Postgres, cifrado con el mismo
// helper AES-256-GCM que ya usa `buzones_email` (apps/api/src/lib/crypto.ts). Reemplaza
// `useMultiFileAuthState` (pensado solo para bots de un solo archivo local, según su propio
// comentario) para que el proceso pueda reiniciarse/redesplegarse sin perder la sesión de
// WhatsApp — igual que el resto de GOZZ no guarda estado solo en el disco de una instancia.
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from "@whiskeysockets/baileys";
import { encrypt, decrypt } from "../../../lib/crypto.js";
import * as repo from "../whatsapp.repository.js";

type FileMap = Record<string, string>; // filename -> JSON string (ya codificado con BufferJSON.replacer)

async function loadFileMap(conexionId: string): Promise<FileMap> {
  const enc = await repo.getConexionSession(conexionId);
  if (!enc) return {};
  try {
    return JSON.parse(decrypt(enc));
  } catch (e: any) {
    console.error(`[whatsapp auth-state] no se pudo leer la sesión de ${conexionId}, se empieza de cero:`, e?.message);
    return {};
  }
}

async function saveFileMap(conexionId: string, files: FileMap): Promise<void> {
  await repo.setConexionSession(conexionId, encrypt(JSON.stringify(files)));
}

export async function usePostgresAuthState(conexionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const files = await loadFileMap(conexionId);

  const readData = (file: string): any => {
    const raw = files[file];
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
  };
  const writeData = (data: any, file: string): void => {
    files[file] = JSON.stringify(data, BufferJSON.replacer);
  };
  const removeData = (file: string): void => {
    delete files[file];
  };

  const creds = readData("creds.json") || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: Record<string, any> = {};
          for (const id of ids) {
            let value = readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in (data as any)[category]) {
              const value = (data as any)[category][id];
              const file = `${category}-${id}.json`;
              if (value) writeData(value, file); else removeData(file);
            }
          }
          // Un solo UPDATE por llamada a set() — Baileys ya agrupa todas las claves de una
          // ráfaga (p.ej. el aluvión de pre-keys al parear) en una sola invocación.
          await saveFileMap(conexionId, files);
        },
      },
    },
    saveCreds: async () => {
      writeData(creds, "creds.json");
      await saveFileMap(conexionId, files);
    },
  };
}

/** Borra la sesión guardada (usado cuando el dispositivo se desvincula desde el teléfono). */
export async function clearAuthState(conexionId: string): Promise<void> {
  await repo.setConexionSession(conexionId, null);
}
