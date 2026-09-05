"use client";
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { X, UserPlus, Trash2, Shield, Eye, Send, Loader2, Check, Crown } from "@/lib/bootstrap-icons";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth-user";

interface ACLEntry {
  id: string;
  user_id: string | null;
  posicion: string | null;
  permiso: "ver" | "enviar";
  user_nombre: string | null;
  user_email: string | null;
  foto_perfil_url: string | null;
}

interface ACLUser {
  id: string;
  nombre: string;
  email: string;
  foto_perfil_url: string | null;
}

interface ACLData {
  buzon: { id: string; email: string; display_name: string | null };
  owner: ACLUser | null;
  acls: ACLEntry[];
  users: ACLUser[];
  posiciones: string[];
  can_manage: boolean;
}

/**
 * Los dos accesos posibles, en un solo sitio: los pinta el conmutador de cada fila Y el formulario
 * de compartir de abajo. Antes cada uno llevaba su propio texto, color e icono copiados a mano, y
 * era cuestión de tiempo que dijeran cosas distintas de lo mismo.
 *
 * `hecho` es lo que se le dice a quien acaba de cambiarlo: qué puede hacer esa persona AHORA. Es
 * más útil que "permiso actualizado", que obliga a mirar la fila para saber qué pasó.
 */
const ACCESOS = [
  { valor: "ver" as const, label: "Solo leer", Icono: Eye,
    activo: "bg-blue-100 text-blue-700", borde: "border-blue-500 bg-blue-50 text-blue-700",
    hecho: "Ahora solo puede leer este buzón" },
  { valor: "enviar" as const, label: "Leer + Enviar", Icono: Send,
    activo: "bg-green-100 text-green-700", borde: "border-green-500 bg-green-50 text-green-700",
    hecho: "Ahora puede leer y enviar desde este buzón" },
];

export function BuzonACLModal({ buzonId, onClose }: { buzonId: string; onClose: () => void }) {
  const [data, setData] = useState<ACLData | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<"user" | "posicion">("user");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedPosicion, setSelectedPosicion] = useState("");
  const [permiso, setPermiso] = useState<"ver" | "enviar">("ver");
  // Traspaso del buzón. `isAdmin` viene de `/api/auth/me`, que lee `nivel_acceso` de la BASE.
  const { isAdmin } = useCurrentUser();
  const [cambiando, setCambiando] = useState(false);
  const [nuevoOwner, setNuevoOwner] = useState("");
  const [traspasando, setTraspasando] = useState(false);
  // Qué fila se está guardando, y hacia qué acceso: `"<aclId>:<permiso>"`. Hace falta el permiso
  // además del id para poner la ruedita en el botón que se pulsó, no en la fila entera.
  const [cambiandoPermiso, setCambiandoPermiso] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/buzones/${buzonId}/acl`);
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || "Error cargando permisos"); onClose(); return; }
      setData(j);
    } catch (e: any) {
      toast.error(e.message || "Error de red");
      onClose();
    } finally { setLoading(false); }
  }, [buzonId, onClose]);

  useEffect(() => { load(); }, [load]);

  /**
   * Traspasa el buzón. El servidor es quien decide: aquí no se comprueba nada que no sea evitar
   * mandar una petición vacía. Los errores llegan con su mensaje —incluido el de "esa persona ya
   * tiene ese buzón conectado"— y se enseñan tal cual.
   */
  const cambiarPropietario = async () => {
    if (!nuevoOwner) return;
    setTraspasando(true);
    try {
      const r = await fetch(`/api/buzones/${buzonId}/propietario`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_user_id: nuevoOwner }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo cambiar el propietario");
      toast.success("Buzón traspasado. El anterior propietario ya no lo ve.");
      setCambiando(false);
      setNuevoOwner("");
      load();
    } catch (e: any) { toast.error(e.message); } finally { setTraspasando(false); }
  };

  const addAcl = async () => {
    if (mode === "user" && !selectedUserId) { toast.error("Seleccioná un usuario"); return; }
    if (mode === "posicion" && !selectedPosicion) { toast.error("Seleccioná una posición"); return; }
    setAdding(true);
    try {
      const body: any = { permiso };
      if (mode === "user") body.user_id = selectedUserId;
      else body.posicion = selectedPosicion;
      const r = await fetch(`/api/buzones/${buzonId}/acl`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || "Error agregando permiso"); return; }
      toast.success(j.updated ? "Permiso actualizado" : "Acceso compartido");
      setSelectedUserId("");
      setSelectedPosicion("");
      setPermiso("ver");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error de red");
    } finally { setAdding(false); }
  };

  /**
   * Cambia el acceso de una fila SIN retirarlo por el camino.
   *
   * 🔴 Antes esto no existía: para bajar a alguien de "leer + enviar" a "solo leer" había que
   * quitarle el acceso y volver a dárselo. Entre las dos cosas se quedaba fuera del buzón, y si la
   * segunda no llegaba a ocurrir —se cierra el modal, se cae la red— se quedaba fuera del todo.
   *
   * No se recarga el modal entero: se actualiza SOLO esa fila, y con **el valor que devuelve el
   * servidor**, no con el que se pidió. Si la base guardó otra cosa, la pantalla enseña lo que hay
   * guardado y no la suposición del cliente.
   */
  const cambiarPermiso = async (aclId: string, permiso: "ver" | "enviar") => {
    setCambiandoPermiso(`${aclId}:${permiso}`);
    try {
      const r = await fetch(`/api/buzones/${buzonId}/acl/${aclId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permiso }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "No se pudo cambiar el acceso");

      const guardado = j.acl?.permiso === "enviar" ? "enviar" : "ver";
      setData((prev) => prev && {
        ...prev,
        acls: prev.acls.map((a) => (a.id === aclId ? { ...a, permiso: guardado } : a)),
      });
      toast.success(ACCESOS.find((o) => o.valor === guardado)!.hecho);
    } catch (e: any) {
      toast.error(e.message || "Error de red");
    } finally { setCambiandoPermiso(null); }
  };

  const removeAcl = async (aclId: string) => {
    if (!confirm("¿Quitar este acceso?")) return;
    try {
      const r = await fetch(`/api/buzones/${buzonId}/acl/${aclId}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || "Error eliminando"); return; }
      toast.success("Acceso retirado");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Error de red");
    }
  };

  const usersById = new Map<string, ACLUser>();
  (data?.users || []).forEach((u) => usersById.set(u.id, u));
  const availableUsersForAdd = (data?.users || []).filter((u) => {
    return !(data?.acls || []).some((a) => a.user_id === u.id);
  });

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-neutral-900 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-ui text-[10px] uppercase tracking-[0.2em] text-brand-orange font-bold mb-1 flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Permisos del buzón
            </div>
            <div className="font-display font-black text-lg truncate">{data?.buzon.email || "..."}</div>
          </div>
          <button onClick={onClose} className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando...
            </div>
          ) : !data ? null : (
            <>
              {/* Owner */}
              {data.owner && (
                <div className="rounded-2xl border border-brand-orange/30 bg-brand-orange/5 p-4">
                  <div className="text-[10px] font-ui uppercase tracking-wider font-bold text-brand-orange mb-2 flex items-center gap-1.5">
                    <Crown className="h-3 w-3" /> Propietario
                  </div>
                  <div className="flex items-center gap-3">
                    {data.owner.foto_perfil_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={data.owner.foto_perfil_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-orange to-brand-red flex items-center justify-center text-white font-bold text-sm">
                        {(data.owner.nombre || data.owner.email || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">{data.owner.nombre || data.owner.email}</div>
                      <div className="text-xs text-neutral-500 truncate">{data.owner.email}</div>
                    </div>
                    <span className="text-[10px] font-ui uppercase tracking-wider font-bold bg-brand-orange text-white px-2 py-1 rounded-full">Acceso total</span>
                    {/* Solo admins. La barrera de verdad está en el servidor (`esAdminEnBase`);
                        esto es para no ofrecer un botón que siempre daría 403. `isAdmin` sale de
                        `/api/auth/me`, que lee `nivel_acceso` de la BASE, no del token. */}
                    {isAdmin && !cambiando && (
                      <button
                        onClick={() => { setCambiando(true); setNuevoOwner(""); }}
                        className="text-[10px] font-ui uppercase tracking-wider font-bold border border-brand-orange/40 text-brand-orange px-2 py-1 rounded-full hover:bg-brand-orange/10 transition"
                      >
                        Cambiar
                      </button>
                    )}
                  </div>

                  {/* ════════════════════════════════════════════════════════════════════════
                      🔴 SE DICE LO QUE IMPLICA **ANTES** DE CONFIRMAR
                      ════════════════════════════════════════════════════════════════════════
                      Cambiar el propietario entrega la correspondencia de una persona a otra: el
                      anterior deja de ver el buzón salvo que además tenga acceso compartido. Que
                      no lo descubra al día siguiente cuando le falte su correo. */}
                  {isAdmin && cambiando && (
                    <div className="mt-3 pt-3 border-t border-brand-orange/20 space-y-3">
                      <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 px-3 py-2.5 text-[12px] text-amber-900 dark:text-amber-200">
                        <strong>{data.owner.nombre || data.owner.email} dejará de ver este buzón</strong>, salvo
                        que le des acceso compartido aquí abajo. Su correo pasa a la bandeja de la persona que
                        elijas, y los avisos del buzón le llegarán a ella.
                      </div>

                      <select
                        value={nuevoOwner}
                        onChange={(e) => setNuevoOwner(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm outline-none focus:ring-2 focus:ring-brand-orange/30"
                      >
                        <option value="">Elige el nuevo propietario…</option>
                        {data.users.map((usr) => (
                          <option key={usr.id} value={usr.id}>{usr.nombre || usr.email}</option>
                        ))}
                      </select>

                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setCambiando(false)}
                          disabled={traspasando}
                          className="h-9 px-3 rounded-xl bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 text-xs font-bold disabled:opacity-60"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={cambiarPropietario}
                          disabled={!nuevoOwner || traspasando}
                          className="h-9 px-3 rounded-xl bg-brand-orange text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {traspasando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {traspasando ? "Traspasando…" : "Sí, traspasar el buzón"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Lista de ACLs */}
              <div>
                <div className="text-[10px] font-ui uppercase tracking-wider font-bold text-neutral-500 mb-2">Personas con acceso ({data.acls.length})</div>
                {data.acls.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-black/10 dark:border-white/10 p-6 text-center text-sm text-neutral-500">
                    Nadie más tiene acceso todavía. Agregá un usuario abajo para compartir.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.acls.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 p-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                        {a.user_id ? (
                          <>
                            {a.foto_perfil_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={a.foto_perfil_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                            ) : (
                              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-xs">
                                {(a.user_nombre || a.user_email || "?").slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate text-sm">{a.user_nombre || a.user_email}</div>
                              <div className="text-[11px] text-neutral-500 truncate">{a.user_email}</div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-200 font-bold text-xs">
                              {(a.posicion || "?").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate text-sm">Posición: {a.posicion}</div>
                              <div className="text-[11px] text-neutral-500">Todos los usuarios con esta posición</div>
                            </div>
                          </>
                        )}
                        {/* ════════════════════════════════════════════════════════════════
                            EL ACCESO SE CAMBIA AQUÍ MISMO, sin quitarlo y volver a darlo.
                            ════════════════════════════════════════════════════════════════
                            Las dos opciones se enseñan SIEMPRE, no solo la vigente: así se ve de
                            un vistazo qué tiene y qué se le puede poner, y basta un clic. Un chip
                            que hay que pulsar para descubrir que alterna esconde la mitad. */}
                        {data.can_manage ? (
                          <div className="flex items-center gap-0.5 p-0.5 rounded-full bg-black/5 dark:bg-white/5 shrink-0" role="group" aria-label="Acceso de esta persona al buzón">
                            {ACCESOS.map(({ valor, label, Icono, activo, hecho }) => {
                              const puesto = a.permiso === valor;
                              const guardando = cambiandoPermiso === `${a.id}:${valor}`;
                              return (
                                <button
                                  key={valor}
                                  // Pulsar el que ya está puesto no manda nada: es lo que hace un
                                  // conmutador, y ahorra una petición que no cambiaría nada.
                                  onClick={() => { if (!puesto) cambiarPermiso(a.id, valor); }}
                                  disabled={!!cambiandoPermiso}
                                  aria-pressed={puesto}
                                  title={puesto ? `Es el acceso que tiene ahora` : hecho}
                                  className={`text-[10px] font-ui uppercase tracking-wider font-bold px-2 py-1 rounded-full flex items-center gap-1 transition disabled:cursor-not-allowed ${
                                    puesto
                                      ? `${activo} shadow-sm`
                                      : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:opacity-40"
                                  }`}
                                >
                                  {guardando ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Icono className="h-2.5 w-2.5" />}
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className={`text-[10px] font-ui uppercase tracking-wider font-bold px-2 py-1 rounded-full flex items-center gap-1 shrink-0 ${a.permiso === "enviar" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                            {a.permiso === "enviar" ? <><Send className="h-2.5 w-2.5" /> Leer + Enviar</> : <><Eye className="h-2.5 w-2.5" /> Solo leer</>}
                          </span>
                        )}
                        {data.can_manage && (
                          <button onClick={() => removeAcl(a.id)} title="Quitar acceso" className="h-8 w-8 rounded-lg hover:bg-red-50 hover:text-red-600 text-neutral-400 flex items-center justify-center transition">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form agregar */}
              {data.can_manage && (
                <div className="rounded-2xl border-2 border-black/10 dark:border-white/10 p-4 space-y-3">
                  <div className="text-[10px] font-ui uppercase tracking-wider font-bold text-brand-orange flex items-center gap-1.5">
                    <UserPlus className="h-3 w-3" /> Compartir acceso
                  </div>

                  <div className="flex gap-2 text-xs">
                    <button onClick={() => setMode("user")} className={`px-3 py-1.5 rounded-lg font-semibold ${mode === "user" ? "bg-brand-orange text-white" : "bg-black/5 dark:bg-white/5 text-neutral-600"}`}>Usuario específico</button>
                    <button onClick={() => setMode("posicion")} className={`px-3 py-1.5 rounded-lg font-semibold ${mode === "posicion" ? "bg-brand-orange text-white" : "bg-black/5 dark:bg-white/5 text-neutral-600"}`}>Por posición</button>
                  </div>

                  {mode === "user" ? (
                    <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm">
                      <option value="">Selecciona un usuario...</option>
                      {availableUsersForAdd.map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre} ({u.email})</option>
                      ))}
                    </select>
                  ) : (
                    <select value={selectedPosicion} onChange={(e) => setSelectedPosicion(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm">
                      <option value="">Selecciona una posición...</option>
                      {data.posiciones.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  )}

                  {/* Las mismas dos opciones que el conmutador de cada fila, de la misma lista: si
                      un día se renombran, se renombran en los dos sitios a la vez. */}
                  <div className="flex gap-2">
                    {ACCESOS.map(({ valor, label, Icono, borde }) => (
                      <button
                        key={valor}
                        onClick={() => setPermiso(valor)}
                        aria-pressed={permiso === valor}
                        className={`flex-1 h-10 px-3 rounded-xl border-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
                          permiso === valor ? borde : "border-black/10 dark:border-white/10 text-neutral-500"
                        }`}
                      >
                        <Icono className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>

                  <button onClick={addAcl} disabled={adding} className="w-full h-11 rounded-xl bg-brand-orange text-white font-bold text-sm hover:bg-brand-orange/90 disabled:opacity-50 flex items-center justify-center gap-2">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {adding ? "Agregando..." : "Compartir acceso"}
                  </button>
                </div>
              )}

              {!data.can_manage && (
                <div className="text-xs text-neutral-500 text-center italic">
                  Solo el propietario del buzón puede modificar los permisos.
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
