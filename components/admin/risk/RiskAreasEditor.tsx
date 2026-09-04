"use client";

// Risk-area editor — draw, reshape, classify and describe the areas the market
// map warns about. Plain Leaflet (no draw plugin): click to add vertices,
// drag a vertex to move it, click a mid-point to insert one, right-click a
// vertex to remove it. Polygons are [lat, lon] rings stored in risk_areas.
import * as React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";
import { saveRiskArea, deleteRiskArea, type RiskAreaRow } from "@/app/(admin)/admin/risk-areas/actions";
import { SEVERITY_LABEL, type RiskSeverity, type LL } from "@/lib/portal/risk-areas";

type Draft = {
  key: string;            // stable list key (db id or a temp key for new shapes)
  id: string | null;
  name: string;
  severity: RiskSeverity;
  alertText: string;
  notes: string;
  isActive: boolean;
  polygon: LL[];
  dirty: boolean;
};

const COLORS: Record<RiskSeverity, string> = { war_zone: "#E24B4A", high_risk: "#EF9F27", advisory: "#F5D48A" };
const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";

function rowToDraft(r: RiskAreaRow): Draft {
  return {
    key: r.id, id: r.id, name: r.name, severity: r.severity, alertText: r.alert_text ?? "",
    notes: r.notes ?? "", isActive: r.is_active,
    polygon: (r.polygon ?? []).map((p) => [Number(p[0]), Number(p[1])] as LL), dirty: false,
  };
}

export function RiskAreasEditor({ initial, canEdit }: { initial: RiskAreaRow[]; canEdit: boolean }) {
  const [areas, setAreas] = React.useState<Draft[]>(() => initial.map(rowToDraft));
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [drawing, setDrawing] = React.useState(false);
  const [draftPts, setDraftPts] = React.useState<LL[]>([]);
  const [saving, setSaving] = React.useState(false);
  const drawingRef = React.useRef(false);
  React.useEffect(() => { drawingRef.current = drawing; }, [drawing]);

  const hostRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const shapesRef = React.useRef<L.LayerGroup | null>(null);
  const vertexRef = React.useRef<L.LayerGroup | null>(null);
  const draftRef = React.useRef<L.LayerGroup | null>(null);

  const selected = areas.find((a) => a.key === selectedKey) ?? null;
  const patchSelected = (patch: Partial<Draft>) =>
    setAreas((xs) => xs.map((a) => (a.key === selectedKey ? { ...a, ...patch, dirty: true } : a)));

  // ── map init ──
  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { worldCopyJump: false, zoomControl: true, attributionControl: false });
    L.tileLayer(TILES, { maxNativeZoom: 16 }).addTo(map);
    map.fitBounds([[-8, -12], [48, 72]], { padding: [10, 10] });
    shapesRef.current = L.layerGroup().addTo(map);
    draftRef.current = L.layerGroup().addTo(map);
    vertexRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      setDraftPts((p) => [...p, [Math.round(e.latlng.lat * 1e4) / 1e4, Math.round(e.latlng.lng * 1e4) / 1e4]]);
    });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    if (ro && hostRef.current) ro.observe(hostRef.current);
    return () => { ro?.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  // ── shapes + vertex handles ──
  React.useEffect(() => {
    const shapes = shapesRef.current, verts = vertexRef.current;
    if (!shapes || !verts) return;
    shapes.clearLayers();
    verts.clearLayers();
    for (const a of areas) {
      if (a.polygon.length < 3) continue;
      const sel = a.key === selectedKey;
      const col = COLORS[a.severity];
      L.polygon(a.polygon, {
        className: `risk-poly${a.isActive ? "" : " is-inactive"}${sel ? " is-selected" : ""}`,
        color: col, weight: sel ? 2.6 : 1.4, dashArray: a.isActive ? undefined : "4 4",
        fillColor: col, fillOpacity: sel ? 0.22 : 0.10,
      })
        .bindTooltip(`${a.name} · ${SEVERITY_LABEL[a.severity]}${a.isActive ? "" : " (inactive)"}`, { sticky: true })
        .on("click", () => { if (!drawingRef.current) setSelectedKey(a.key); })
        .addTo(shapes);
    }
    const s = areas.find((a) => a.key === selectedKey);
    if (s && canEdit && !drawing) {
      s.polygon.forEach((pt, i) => {
        L.marker(pt, {
          draggable: true,
          icon: L.divIcon({ className: "ra-vertex", html: "<div></div>", iconSize: [12, 12], iconAnchor: [6, 6] }),
          title: "Drag to move · right-click to remove",
        })
          .on("dragend", (ev) => {
            const ll = (ev.target as L.Marker).getLatLng();
            setAreas((xs) => xs.map((a) => a.key === s.key
              ? { ...a, dirty: true, polygon: a.polygon.map((q, j) => (j === i ? [Math.round(ll.lat * 1e4) / 1e4, Math.round(ll.lng * 1e4) / 1e4] as LL : q)) }
              : a));
          })
          .on("contextmenu", (ev) => {
            L.DomEvent.stop(ev as unknown as L.LeafletEvent);
            if (s.polygon.length <= 3) { toast.error("An area needs at least three points."); return; }
            setAreas((xs) => xs.map((a) => a.key === s.key ? { ...a, dirty: true, polygon: a.polygon.filter((_, j) => j !== i) } : a));
          })
          .addTo(verts);
        // mid-point handle → inserts a vertex on that edge
        const next = s.polygon[(i + 1) % s.polygon.length];
        const mid: LL = [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2];
        L.marker(mid, {
          icon: L.divIcon({ className: "ra-mid", html: "<div></div>", iconSize: [10, 10], iconAnchor: [5, 5] }),
          title: "Click to add a point here",
        })
          .on("click", () => {
            setAreas((xs) => xs.map((a) => a.key === s.key
              ? { ...a, dirty: true, polygon: [...a.polygon.slice(0, i + 1), mid, ...a.polygon.slice(i + 1)] }
              : a));
          })
          .addTo(verts);
      });
    }
  }, [areas, selectedKey, drawing, canEdit]);

  // ── draft (drawing mode) ──
  React.useEffect(() => {
    const d = draftRef.current;
    if (!d) return;
    d.clearLayers();
    if (!drawing) return;
    if (draftPts.length >= 2) L.polyline(draftPts, { color: "#7BB8F0", weight: 2, dashArray: "5 5" }).addTo(d);
    if (draftPts.length >= 3) L.polygon(draftPts, { color: "#7BB8F0", weight: 0, fillColor: "#7BB8F0", fillOpacity: 0.15, interactive: false }).addTo(d);
    for (const p of draftPts) L.circleMarker(p, { radius: 4, color: "#fff", fillColor: "#185FA5", fillOpacity: 1, weight: 1.5 }).addTo(d);
  }, [drawing, draftPts]);

  const startDraw = () => { setSelectedKey(null); setDraftPts([]); setDrawing(true); };
  const cancelDraw = () => { setDrawing(false); setDraftPts([]); };
  const finishDraw = () => {
    if (draftPts.length < 3) { toast.error("Click at least three points on the chart first."); return; }
    const key = `new-${Date.now()}`;
    setAreas((xs) => [...xs, { key, id: null, name: "New area", severity: "high_risk", alertText: "", notes: "", isActive: true, polygon: draftPts, dirty: true }]);
    setSelectedKey(key);
    setDrawing(false);
    setDraftPts([]);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await saveRiskArea({
      id: selected.id, name: selected.name, severity: selected.severity, alertText: selected.alertText || null,
      polygon: selected.polygon, isActive: selected.isActive, notes: selected.notes || null,
    });
    setSaving(false);
    if (!res.success) { toast.error(res.error); return; }
    setAreas((xs) => xs.map((a) => (a.key === selected.key ? { ...a, id: res.data.id, dirty: false } : a)));
    toast.success(`"${selected.name}" saved — live on the market map.`);
  };
  const remove = async () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"? Routes through it will stop showing the alert.`)) return;
    if (selected.id) {
      const res = await deleteRiskArea(selected.id);
      if (!res.success) { toast.error(res.error); return; }
    }
    setAreas((xs) => xs.filter((a) => a.key !== selected.key));
    setSelectedKey(null);
    toast.success("Area removed.");
  };
  const zoomTo = (a: Draft) => { if (a.polygon.length >= 3) mapRef.current?.fitBounds(L.latLngBounds(a.polygon), { padding: [40, 40] }); };

  const inp: React.CSSProperties = { width: "100%", padding: "7px 9px", borderRadius: 6, border: "0.5px solid #C4D1E6", font: "inherit", fontSize: 12.5 };
  const lab: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#4B5566", marginBottom: 4, display: "block" };

  return (
    <div className="ra-layout">
      <style>{`
        .ra-vertex div { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 2px solid #185FA5; box-shadow: 0 0 0 1px rgba(0,0,0,.35); cursor: grab; }
        .ra-mid div { width: 10px; height: 10px; border-radius: 50%; background: #185FA5; opacity: .55; border: 1px solid #fff; cursor: copy; }
        .ra-mid div:hover { opacity: 1; }
        @keyframes risk-pulse { 0% { stroke-opacity: .95; fill-opacity: .10; } 50% { stroke-opacity: .45; fill-opacity: .30; } 100% { stroke-opacity: .95; fill-opacity: .10; } }
        path.risk-poly { animation: risk-pulse 2.4s ease-in-out infinite; }
        path.risk-poly.is-inactive { animation: none; }
        path.risk-poly.is-selected { animation-duration: 1.4s; }
        .ra-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; border: 0.5px solid transparent; }
        .ra-row:hover { background: #F2F6FB; }
        .ra-row.is-on { background: #E6F1FB; border-color: #B7D3F2; }
        .ra-sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
        .ra-btn { font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: 7px; cursor: pointer; border: 0.5px solid #C4D1E6; background: #fff; color: #1B3A5C; }
        .ra-btn.is-primary { background: #0D2545; color: #fff; border-color: #0D2545; }
        .ra-btn.is-danger { color: #A32D2D; border-color: #E9B4B4; }
        .ra-btn:disabled { opacity: .5; cursor: default; }
        .ra-tools { position: absolute; top: 10px; left: 10px; right: 10px; z-index: 500; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; background: rgba(12,31,48,.9); padding: 6px 8px; border-radius: 8px; color: #fff; font-size: 11.5px; width: max-content; max-width: calc(100% - 20px); }
        .ra-layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 14px; align-items: start; }
        .ra-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .ra-map { padding: 0; position: relative; overflow: hidden; min-height: 640px; }
        .ra-form-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 900px) {
          .ra-layout { grid-template-columns: 1fr; }
          /* chart first so the admin can draw straight away; list + form below */
          .ra-map { order: -1; min-height: 58vh; height: 58vh; }
          .ra-tools { font-size: 12px; }
          .ra-tools .ra-btn { padding: 8px 12px; }
          .ra-vertex div { width: 18px; height: 18px; }
          .ra-mid div { width: 14px; height: 14px; opacity: .75; }
          .ra-row { padding: 10px 12px; }
          .ra-btn { padding: 9px 14px; font-size: 13px; }
        }
      `}</style>

      <div className="ra-side">
        <div className="adm-card" style={{ padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 6px 8px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#1B3A5C" }}>Areas ({areas.length})</span>
            {canEdit && !drawing && <button className="ra-btn is-primary" onClick={startDraw}>+ Draw new area</button>}
          </div>
          {areas.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#6B7A99" }}>No areas yet — draw one on the chart.</div>}
          {areas.map((a) => (
            <div key={a.key} className={`ra-row${a.key === selectedKey ? " is-on" : ""}`} onClick={() => { setSelectedKey(a.key); zoomTo(a); }}>
              <span className="ra-sw" style={{ background: COLORS[a.severity] }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1B3A5C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}{a.dirty ? " •" : ""}</div>
                <div style={{ fontSize: 10.5, color: "#6B7A99" }}>{SEVERITY_LABEL[a.severity]} · {a.polygon.length} pts{a.isActive ? "" : " · inactive"}</div>
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="adm-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={lab}>Name</label>
              <input style={inp} value={selected.name} disabled={!canEdit} onChange={(e) => patchSelected({ name: e.target.value })} />
            </div>
            <div>
              <label style={lab}>Severity</label>
              <select style={inp} value={selected.severity} disabled={!canEdit} onChange={(e) => patchSelected({ severity: e.target.value as RiskSeverity })}>
                <option value="war_zone">War zone — insurers exclude or surcharge heavily</option>
                <option value="high_risk">High-risk area — additional war-risk premium</option>
                <option value="advisory">Advisory — check terms before fixing</option>
              </select>
            </div>
            <div>
              <label style={lab}>Alert shown to users</label>
              <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={selected.alertText} disabled={!canEdit}
                placeholder="e.g. Transits the Red Sea listed area — additional war-risk premium applies."
                onChange={(e) => patchSelected({ alertText: e.target.value })} />
            </div>
            <div>
              <label style={lab}>Internal notes</label>
              <input style={inp} value={selected.notes} disabled={!canEdit} placeholder="source, date reviewed…" onChange={(e) => patchSelected({ notes: e.target.value })} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#1B3A5C" }}>
              <input type="checkbox" checked={selected.isActive} disabled={!canEdit} onChange={(e) => patchSelected({ isActive: e.target.checked })} />
              Active — routes through it raise the alert
            </label>
            <div style={{ fontSize: 11, color: "#6B7A99" }}>
              {selected.polygon.length} points · drag a handle to reshape, click a small dot to add a point, right-click a handle to remove it.
            </div>
            {canEdit && (
              <div className="ra-form-actions">
                <button className="ra-btn is-primary" onClick={save} disabled={saving || !selected.dirty && !!selected.id}>{saving ? "Saving…" : selected.id ? "Save changes" : "Save area"}</button>
                <button className="ra-btn is-danger" onClick={remove} disabled={saving}>Delete</button>
                <button className="ra-btn" style={{ marginLeft: "auto" }} onClick={() => setSelectedKey(null)}>Close</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="adm-card ra-map">
        <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
        {drawing && (
          <div className="ra-tools">
            <span>Click the chart to add points ({draftPts.length})</span>
            <button className="ra-btn is-primary" onClick={finishDraw} disabled={draftPts.length < 3}>Finish shape</button>
            <button className="ra-btn" onClick={() => setDraftPts((p) => p.slice(0, -1))} disabled={draftPts.length === 0}>Undo point</button>
            <button className="ra-btn" onClick={cancelDraw}>Cancel</button>
          </div>
        )}
        {!drawing && !selected && (
          <div className="ra-tools" style={{ pointerEvents: "none" }}>Click an area to edit it{canEdit ? ", or draw a new one" : ""}.</div>
        )}
      </div>
    </div>
  );
}
