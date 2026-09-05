"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, Edit3, Save, X, Search, Crown, Building2, ZoomIn, ZoomOut, Maximize2, LayoutGrid, Users, Lock, Move, RotateCcw, Hand, MousePointer2, Plus, Trash2, ChevronUp } from "@/lib/bootstrap-icons";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { initialsOf, useCurrentUser } from "@/lib/auth-user";
import { FancySelect } from "@/components/ui/FancySelect";

interface Departamento {
  id: string;
  nombre: string;
  color: string | null;
  jefe_id: string | null;
  parent_id: string | null;
  pos_x: number;
  pos_y: number;
  orden: number;
  jefe_nombre: string | null;
  jefe_foto: string | null;
  empleados_count: number;
}

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  foto_perfil_url: string | null;
  nivel_acceso: string;
  supervisor_id: string | null;
  departamento_id: string | null;
  cargo_id: string | null;
  cargo_codigo: string | null;
  cargo_nombre: string | null;
}

interface Cargo { id: string; codigo: string; nombre: string; valor_punto_usd: string; departamento_id?: string | null }

const DEFAULT_LAYOUT: Record<string, { x: number; y: number }> = {
  // CEO arriba centro, top departments en row, sub-departments en row más abajo
};

export default function OrganigramaPage() {
  const { isAdmin } = useCurrentUser();
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [ceo, setCeo] = useState<Usuario | null>(null);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingDept, setDraggingDept] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [centered, setCentered] = useState(false);
  const [openUserAssign, setOpenUserAssign] = useState<Usuario | null>(null);
  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [newDeptColor, setNewDeptColor] = useState("#5750E8");
  const [draggingDeptOverDept, setDraggingDeptOverDept] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/equipo/organigrama-visual").then((r) => r.json()),
        fetch("/api/equipo/cargos").then((r) => r.json())
      ]);
      const depts: Departamento[] = r1.departamentos || [];
      // Auto layout si todas pos_x=0 y pos_y=0
      const allZero = depts.every((d) => d.pos_x === 0 && d.pos_y === 0);
      if (allZero) {
        applyAutoLayout(depts);
      }
      setDepartamentos(depts);
      setUsuarios(r1.usuarios || []);
      setCeo(r1.ceo || null);
      setCargos(r2.cargos || []);
    } catch (e: any) { toast.error(e.message || "Error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading || centered || !canvasRef.current) return;
    const w = canvasRef.current.clientWidth;
    setPan({ x: w / 2 - 1200, y: 30 });
    setCentered(true);
  }, [loading, centered]);

  const onWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = Math.max(0.3, Math.min(2, zoom * delta));
    const scale = newZoom / zoom;
    setPan((p) => ({ x: mx - (mx - p.x) * scale, y: my - (my - p.y) * scale }));
    setZoom(newZoom);
  };

  function applyAutoLayout(depts: Departamento[]) {
    // CEO en (0, 0) virtual; Top depts a Y=200, Sub-depts a Y=420
    const tops = depts.filter((d) => !d.parent_id);
    const subsByParent: Record<string, Departamento[]> = {};
    depts.filter((d) => d.parent_id).forEach((d) => {
      const k = d.parent_id!;
      if (!subsByParent[k]) subsByParent[k] = [];
      subsByParent[k].push(d);
    });
    const cardW = 240;
    const gap = 24;
    const totalTopWidth = tops.length * cardW + (tops.length - 1) * gap;
    let x = -totalTopWidth / 2;
    tops.forEach((d) => {
      d.pos_x = x; d.pos_y = 220;
      const subs = subsByParent[d.id] || [];
      const totalSubW = subs.length * cardW + (subs.length - 1) * gap;
      let sx = x - (totalSubW - cardW) / 2;
      subs.forEach((sd) => {
        sd.pos_x = sx; sd.pos_y = 440;
        sx += cardW + gap;
      });
      x += cardW + gap;
    });
  }

  const usuariosSinDepto = useMemo(() => usuarios.filter((u) => !u.departamento_id && u.id !== ceo?.id), [usuarios, ceo]);
  const filteredUsuarios = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return usuarios.filter((u) => u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usuarios, search]);

  const asignarUser = async (userId: string, patch: any) => {
    try {
      const r = await fetch(`/api/equipo/usuarios/${userId}/perfil`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!r.ok) throw new Error("Error");
      toast.success("Asignado");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const createDept = async () => {
    if (!newDeptName.trim()) { toast.error("Nombre requerido"); return; }
    try {
      const r = await fetch("/api/departamentos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: newDeptName.trim(), color: newDeptColor })
      });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || "Error"); }
      toast.success("Departamento creado");
      setShowAddDept(false);
      setNewDeptName("");
      setNewDeptColor("#5750E8");
      load();
    } catch (e: any) { toast.error(e.message || "Error"); }
  };

  const deleteDept = async (deptId: string, name: string) => {
    if (!confirm(`Eliminar departamento "${name}"? Los empleados quedarán sin departamento.`)) return;
    try {
      const r = await fetch(`/api/departamentos/${deptId}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || "Error"); }
      toast.success("Eliminado");
      load();
    } catch (e: any) { toast.error(e.message || "Error"); }
  };

  const setDeptParent = async (deptId: string, parentId: string | null) => {
    try {
      const r = await fetch(`/api/equipo/departamentos/${deptId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: parentId })
      });
      if (!r.ok) throw new Error("Error");
      toast.success(parentId ? "Movido como sub-depto" : "Movido a top-level");
      load();
    } catch (e: any) { toast.error(e.message || "Error"); }
  };


  const saveDeptPosition = useCallback(async (id: string, pos_x: number, pos_y: number) => {
    try {
      await fetch(`/api/equipo/departamentos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pos_x: Math.round(pos_x), pos_y: Math.round(pos_y) })
      });
    } catch {}
  }, []);

  // Drag handlers (departamento)
  const onDeptMouseDown = (e: React.MouseEvent, dept: Departamento) => {
    if (!editMode) return;
    e.stopPropagation();
    setDraggingDept(dept.id);
    setDragOffset({
      x: e.clientX - dept.pos_x * zoom - pan.x,
      y: e.clientY - dept.pos_y * zoom - pan.y
    });
  };
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (tool === "hand" || e.button === 1) {
      setPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (panning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    if (!draggingDept) return;
    const newX = (e.clientX - dragOffset.x - pan.x) / zoom;
    const newY = (e.clientY - dragOffset.y - pan.y) / zoom;
    setDepartamentos((prev) => prev.map((d) => d.id === draggingDept ? { ...d, pos_x: newX, pos_y: newY } : d));
  };
  const onMouseUp = () => {
    if (panning) { setPanning(false); return; }
    if (draggingDept) {
      // Si está sobre otro dept, asignar como sub-dept (parent_id = otro)
      if (draggingDeptOverDept && draggingDeptOverDept !== draggingDept) {
        // Validar no crear ciclo: target no puede ser descendiente de draggingDept
        const target = departamentos.find((x) => x.id === draggingDeptOverDept);
        const dragging = departamentos.find((x) => x.id === draggingDept);
        if (target && dragging) {
          // Check ancestor chain
          let cur: string | null = target.parent_id;
          let cycle = false;
          const seen = new Set<string>();
          while (cur) {
            if (cur === draggingDept) { cycle = true; break; }
            if (seen.has(cur)) break;
            seen.add(cur);
            const p = departamentos.find((x) => x.id === cur);
            cur = p ? p.parent_id : null;
          }
          if (!cycle) {
            setDeptParent(draggingDept, draggingDeptOverDept);
          } else {
            toast.error("No se puede crear un ciclo en la jerarquía");
            // restaurar position
            load();
          }
        }
      } else {
        const d = departamentos.find((x) => x.id === draggingDept);
        if (d) saveDeptPosition(d.id, d.pos_x, d.pos_y);
      }
    }
    setDraggingDept(null);
    setDraggingDeptOverDept(null);
  };

  const fitView = () => {
    if (!canvasRef.current) return;
    const w = canvasRef.current.clientWidth;
    setZoom(1);
    setPan({ x: w / 2 - 1200, y: 30 });
  };

  // Drag user → departamento
  const onUserDragStart = (e: React.DragEvent, userId: string) => {
    e.dataTransfer.setData("user_id", userId);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDeptDragOver = (e: React.DragEvent) => {
    if (!editMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDeptDrop = (e: React.DragEvent, deptId: string) => {
    if (!editMode) return;
    e.preventDefault();
    const userId = e.dataTransfer.getData("user_id");
    if (userId) asignarUser(userId, { departamento_id: deptId });
  };

  const resetLayout = () => {
    if (!confirm("¿Resetear layout a posiciones automáticas?")) return;
    const cloned = departamentos.map((d) => ({ ...d, pos_x: 0, pos_y: 0 }));
    applyAutoLayout(cloned);
    setDepartamentos(cloned);
    Promise.all(cloned.map((d) => saveDeptPosition(d.id, d.pos_x, d.pos_y))).then(() => toast.success("Layout reseteado"));
  };

  const usersInDept = (deptId: string) => usuarios.filter((u) => u.departamento_id === deptId && u.id !== ceo?.id);
  const tops = departamentos.filter((d) => !d.parent_id);
  const subs = departamentos.filter((d) => d.parent_id);

  return (
    <AppShell>
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-5 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-brand-orange font-ui uppercase text-[11px] tracking-[0.12em] mb-2">
              <Sparkles className="h-3.5 w-3.5" /> Organización
            </div>
            <h1 className="font-display text-4xl font-black leading-tight">
              <span className="text-gradient-orange">Organigrama</span>
            </h1>
            <p className="mt-2 text-neutral-500 text-sm">
              {usuarios.length} colaboradores · {departamentos.length} departamentos · {usuariosSinDepto.length} sin asignar
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/equipo" className="h-9 px-3 rounded-xl bg-white border border-neutral-200 font-ui text-[11px] font-bold uppercase tracking-wider text-neutral-500 hover:bg-neutral-50 flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" /> Directorio
            </Link>
            {isAdmin && (
              <button
                onClick={() => setEditMode(!editMode)}
                className={cn(
                  "h-9 px-4 rounded-xl font-ui text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition",
                  editMode
                    ? "bg-brand-orange text-white shadow-md hover:shadow-lg"
                    : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                )}
              >
                {editMode ? <><Save className="h-3.5 w-3.5" /> Editando</> : <><Edit3 className="h-3.5 w-3.5" /> Editar</>}
              </button>
            )}
            {editMode && (
              <>
                <button
                  onClick={() => setShowAddDept(true)}
                  className="h-9 px-3 rounded-xl bg-emerald-600 text-white text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5 shadow hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Depto
                </button>
                <button
                  onClick={resetLayout}
                  className="h-9 px-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[11px] font-ui font-bold uppercase tracking-wider flex items-center gap-1.5"
                  title="Reset auto layout"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
              </>
            )}
            <div className="flex items-center gap-1 bg-white border border-neutral-200 rounded-xl p-1">
              <button
                onClick={() => setTool(tool === "hand" ? "select" : "hand")}
                className={cn("h-7 w-7 rounded-lg flex items-center justify-center transition", tool === "hand" ? "bg-brand-orange text-white" : "hover:bg-neutral-100 text-neutral-600")}
                title={tool === "hand" ? "Modo selección" : "Modo navegación (mano)"}
              >
                {tool === "hand" ? <Hand className="h-3.5 w-3.5" /> : <MousePointer2 className="h-3.5 w-3.5" />}
              </button>
              <div className="w-px h-5 bg-neutral-200 mx-0.5" />
              <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="h-7 w-7 rounded-lg hover:bg-neutral-100 flex items-center justify-center" title="Alejar"><ZoomOut className="h-3.5 w-3.5" /></button>
              <span className="text-[10px] font-ui font-bold tabular-nums w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="h-7 w-7 rounded-lg hover:bg-neutral-100 flex items-center justify-center" title="Acercar"><ZoomIn className="h-3.5 w-3.5" /></button>
              <div className="w-px h-5 bg-neutral-200 mx-0.5" />
              <button onClick={fitView} className="h-7 px-2 rounded-lg hover:bg-neutral-100 text-[10px] font-bold uppercase flex items-center gap-1" title="Ajustar vista"><Maximize2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </motion.div>

        {!isAdmin && (
          <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-ui text-neutral-400 bg-neutral-100 px-3 py-1.5 rounded-lg">
            <Lock className="h-3 w-3" /> Solo admin puede editar el organigrama
          </div>
        )}

        <div className="flex gap-4">
          {/* Canvas tipo Miro */}
          <div className="flex-1 bg-white rounded-2xl border border-neutral-200 overflow-hidden relative" style={{ height: "calc(100vh - 280px)", minHeight: 600 }}>
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
              </div>
            ) : (
              <div
                ref={canvasRef}
                className="absolute inset-0 overflow-hidden select-none"
                style={{
                  backgroundImage: "radial-gradient(circle, #d4d4d8 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                  cursor: panning ? "grabbing" : tool === "hand" ? "grab" : draggingDept ? "grabbing" : "default",
                }}
                onMouseDown={onCanvasMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onWheel={onWheel}
              >
                <div
                  className="relative origin-top-left transition-transform"
                  style={{
                    width: 2400,
                    height: 1800,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  }}
                >
                  {/* CEO card centrada */}
                  {ceo && (
                    <div className="absolute" style={{ left: 1100, top: 60 }}>
                      <div className="w-[200px] rounded-2xl border-2 border-brand-orange bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow">
                            <Crown className="h-6 w-6 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold uppercase text-amber-700 tracking-wider">CEO</div>
                            <div className="text-sm font-display font-black truncate">{ceo.nombre}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SVG líneas de conexión */}
                  <svg className="absolute inset-0 pointer-events-none" width="2400" height="1800">
                    {tops.map((d) => {
                      const ceoX = 1200, ceoY = 130;
                      const dx = d.pos_x + 1200 + 120, dy = d.pos_y + 200;
                      return (
                        <path
                          key={d.id}
                          d={`M ${ceoX},${ceoY} C ${ceoX},${(ceoY + dy) / 2} ${dx},${(ceoY + dy) / 2} ${dx},${dy}`}
                          stroke={d.color || "#5750E8"}
                          strokeWidth="2"
                          fill="none"
                          opacity="0.4"
                        />
                      );
                    })}
                    {subs.map((sd) => {
                      const parent = departamentos.find((d) => d.id === sd.parent_id);
                      if (!parent) return null;
                      const px = parent.pos_x + 1200 + 120, py = parent.pos_y + 200 + 60;
                      const cx = sd.pos_x + 1200 + 120, cy = sd.pos_y + 200;
                      return (
                        <path
                          key={sd.id}
                          d={`M ${px},${py} C ${px},${(py + cy) / 2} ${cx},${(py + cy) / 2} ${cx},${cy}`}
                          stroke={sd.color || "#5750E8"}
                          strokeWidth="2"
                          fill="none"
                          opacity="0.4"
                        />
                      );
                    })}
                  </svg>

                  {/* Departamentos */}
                  {departamentos.map((d) => {
                    const userList = usersInDept(d.id);
                    const isSubDept = !!d.parent_id;
                    return (
                      <motion.div
                        key={d.id}
                        layout={!editMode}
                        className={cn(
                          "absolute rounded-2xl border-2 bg-white shadow-md transition-all",
                          editMode && "hover:shadow-xl ring-2 ring-transparent hover:ring-brand-orange/30",
                          editMode && draggingDept === d.id && "shadow-2xl ring-brand-orange",
                          draggingDeptOverDept === d.id && draggingDept && draggingDept !== d.id && "ring-4 ring-emerald-400 scale-105",
                          draggingDept === d.id ? "z-30" : "z-10"
                        )}
                        style={{
                          left: d.pos_x + 1200,
                          top: d.pos_y + 200,
                          width: 240,
                          borderColor: d.color || "#5750E8",
                          cursor: editMode ? "grab" : "default",
                        }}
                        onMouseDown={(e) => onDeptMouseDown(e, d)}
                        onMouseEnter={() => { if (draggingDept && draggingDept !== d.id) setDraggingDeptOverDept(d.id); }}
                        onMouseLeave={() => setDraggingDeptOverDept(null)}
                        onDragOver={onDeptDragOver}
                        onDrop={(e) => onDeptDrop(e, d.id)}
                      >
                        {/* Header dept */}
                        <div className="px-3 py-2 rounded-t-2xl flex items-center gap-2" style={{ background: (d.color || "#5750E8") + "15" }}>
                          <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: d.color || "#5750E8" }}>
                            <Building2 className="h-3.5 w-3.5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] uppercase tracking-wider font-ui text-neutral-500 leading-tight">{isSubDept ? "Sub-depto" : "Departamento"}</div>
                            <div className="text-sm font-display font-black truncate" style={{ color: d.color || "#000" }}>{d.nombre}</div>
                          </div>
                          {editMode && (
                            <div className="flex items-center gap-1 shrink-0">
                              {d.parent_id && (
                                <button
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => { e.stopPropagation(); setDeptParent(d.id, null); }}
                                  className="h-5 w-5 rounded hover:bg-white/40 flex items-center justify-center text-neutral-600"
                                  title="Mover a top-level"
                                >
                                  <ChevronUp className="h-3 w-3" />
                                </button>
                              )}
                              <Move className="h-3 w-3 text-neutral-400" />
                              <button
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); deleteDept(d.id, d.nombre); }}
                                className="h-5 w-5 rounded hover:bg-red-100 flex items-center justify-center text-red-500"
                                title="Eliminar departamento"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Jefe */}
                        {d.jefe_nombre ? (
                          <div className="px-3 py-1.5 border-b border-neutral-100 flex items-center gap-2 bg-neutral-50/50">
                            {d.jefe_foto
                              ? <img src={d.jefe_foto} className="h-6 w-6 rounded-full object-cover" alt="" />
                              : <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white text-[9px] font-bold flex items-center justify-center">{initialsOf(d.jefe_nombre)}</div>}
                            <div className="text-[10px] text-neutral-700 font-semibold truncate flex-1">{d.jefe_nombre}</div>
                            <span className="text-[8px] uppercase font-bold text-amber-600">Jefe</span>
                          </div>
                        ) : (
                          <div className="px-3 py-1.5 border-b border-neutral-100 text-[10px] text-neutral-400 italic">Sin jefe asignado</div>
                        )}

                        {/* Empleados */}
                        <div className="p-2 space-y-1 min-h-[40px] max-h-[160px] overflow-y-auto">
                          {userList.length === 0 ? (
                            <div className={cn("py-2 text-center text-[10px] text-neutral-400", editMode && "border border-dashed border-neutral-300 rounded")}>
                              {editMode ? "Arrastrá un usuario aquí" : "Sin empleados"}
                            </div>
                          ) : (
                            userList.map((u) => (
                              <div
                                key={u.id}
                                draggable={editMode}
                                onDragStart={(e) => onUserDragStart(e, u.id)}
                                onClick={() => editMode && setOpenUserAssign(u)}
                                className={cn(
                                  "flex items-center gap-2 px-2 py-1 rounded-lg",
                                  editMode ? "cursor-grab hover:bg-neutral-50" : ""
                                )}
                              >
                                {u.foto_perfil_url
                                  ? <img src={u.foto_perfil_url} className="h-6 w-6 rounded-full object-cover" alt="" />
                                  : <div className="h-6 w-6 rounded-full bg-gradient-to-br from-neutral-400 to-neutral-600 text-white text-[8px] font-bold flex items-center justify-center">{initialsOf(u.nombre)}</div>}
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-semibold truncate">{u.nombre}</div>
                                  {u.cargo_nombre && <div className="text-[9px] text-neutral-500 truncate">{u.cargo_nombre}</div>}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar derecho con users sin asignar */}
          <div className="w-72 shrink-0 bg-white rounded-2xl border border-neutral-200 overflow-hidden flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: 600 }}>
            <div className="p-3 border-b border-neutral-100 bg-neutral-50">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-brand-orange" />
                <h3 className="text-sm font-display font-black">Sin departamento</h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-orange/10 text-brand-orange font-bold">{usuariosSinDepto.length}</span>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="w-full h-8 pl-7 pr-2 rounded-lg bg-white border border-neutral-200 text-[11px] outline-none focus:border-brand-orange"
                />
              </div>
              {editMode && <p className="text-[10px] text-neutral-400 mt-2">Arrastrá users a un departamento</p>}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {(filteredUsuarios || usuariosSinDepto).map((u) => (
                <div
                  key={u.id}
                  draggable={editMode}
                  onDragStart={(e) => onUserDragStart(e, u.id)}
                  onClick={() => isAdmin && setOpenUserAssign(u)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-2 rounded-lg border border-transparent",
                    editMode ? "cursor-grab hover:bg-orange-50 hover:border-brand-orange/30 active:opacity-50" : "hover:bg-neutral-50",
                  )}
                >
                  {u.foto_perfil_url
                    ? <img src={u.foto_perfil_url} className="h-8 w-8 rounded-full object-cover" alt="" />
                    : <div className="h-8 w-8 rounded-full bg-gradient-to-br from-neutral-400 to-neutral-600 text-white text-[10px] font-bold flex items-center justify-center">{initialsOf(u.nombre)}</div>}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold truncate">{u.nombre}</div>
                    <div className="text-[9px] text-neutral-500 truncate">{u.email}</div>
                  </div>
                </div>
              ))}
              {usuariosSinDepto.length === 0 && !search && (
                <div className="py-12 text-center text-[11px] text-neutral-400">Todos asignados ✓</div>
              )}
            </div>
          </div>
        </div>

        {/* Modal asignar user (depto + cargo) */}
        {openUserAssign && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpenUserAssign(null)}>
            <motion.div
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-5">
                {openUserAssign.foto_perfil_url
                  ? <img src={openUserAssign.foto_perfil_url} className="h-12 w-12 rounded-full object-cover" alt="" />
                  : <div className="h-12 w-12 rounded-full bg-gradient-to-br from-brand-orange to-brand-gold text-white font-bold flex items-center justify-center">{initialsOf(openUserAssign.nombre)}</div>}
                <div className="flex-1">
                  <div className="text-base font-display font-black">{openUserAssign.nombre}</div>
                  <div className="text-xs text-neutral-500">{openUserAssign.email}</div>
                </div>
                <button onClick={() => setOpenUserAssign(null)} className="text-neutral-400 hover:text-neutral-700"><X className="h-4 w-4" /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Departamento</label>
                  <select
                    defaultValue={openUserAssign.departamento_id || ""}
                    onChange={(e) => asignarUser(openUserAssign.id, { departamento_id: e.target.value || null })}
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
                  >
                    <option value="">— Sin departamento —</option>
                    {departamentos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Cargo</label>
                  <select
                    defaultValue={openUserAssign.cargo_id || ""}
                    onChange={(e) => asignarUser(openUserAssign.id, { cargo_id: e.target.value || null })}
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
                  >
                    <option value="">— Sin cargo —</option>
                    {cargos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  onClick={() => { asignarUser(openUserAssign.id, { departamento_id: null, cargo_id: null }); setOpenUserAssign(null); }}
                  className="flex-1 h-10 rounded-xl border border-neutral-200 text-xs font-ui font-bold uppercase tracking-wider hover:bg-neutral-50"
                >
                  Quitar todo
                </button>
                <button
                  onClick={() => setOpenUserAssign(null)}
                  className="flex-1 h-10 rounded-xl bg-brand-orange text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-brand-gold"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
        {/* Modal crear departamento */}
        {showAddDept && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAddDept(false)}>
            <motion.div
              initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-lg font-black">Nuevo departamento</h3>
                <button onClick={() => setShowAddDept(false)}><X className="h-4 w-4 text-neutral-400" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Nombre</label>
                  <input
                    autoFocus
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createDept(); }}
                    placeholder="Ej: Marketing, Soporte..."
                    className="w-full h-10 px-3 rounded-xl border border-neutral-200 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-ui uppercase tracking-wider text-neutral-500 block mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    {["#5750E8", "#43A847", "#2196C9", "#E53935", "#8338EC", "#06BCC1", "#9D174D", "#F59E0B"].map((c) => (
                      <button
                        key={c}
                        onClick={() => setNewDeptColor(c)}
                        className={cn("h-8 w-8 rounded-lg border-2 transition", newDeptColor === c ? "border-neutral-900 scale-110" : "border-transparent")}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setShowAddDept(false)} className="flex-1 h-10 rounded-xl border border-neutral-200 text-xs font-ui font-bold uppercase tracking-wider hover:bg-neutral-50">Cancelar</button>
                <button onClick={createDept} className="flex-1 h-10 rounded-xl bg-emerald-600 text-white text-xs font-ui font-bold uppercase tracking-wider hover:bg-emerald-700">Crear</button>
              </div>
            </motion.div>
          </div>
        )}

    </AppShell>
  );
}
