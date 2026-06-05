// asb/map.jsx, Leaflet-based map (Prompt 13+14 v3)
// Replaces the previous SVG implementation entirely.
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  MAP LAYER MODEL — read this first (for new designers)            │
// │                                                                    │
// │  There is ONE map component (window.MapPane) used by every page.   │
// │  What it draws is decided by ONE registry: window.ASB_MAP_LAYERS   │
// │  (in asb/map-shared.jsx). Nothing renders unless it's declared     │
// │  there. The hierarchy is:                                          │
// │                                                                    │
// │   1. BASE TIER (locked, always on, identical everywhere):          │
// │        sea basemap + ports + the light/dark toggle.                │
// │   2. HOME side (locked on): each page declares its "home" in the   │
// │        registry `contexts` map — cargo pages show cargo, vessel    │
// │        pages show vessels, the dashboard shows both.               │
// │   3. OPPONENT layer (the ONE adjustable toggle, OFF by default):   │
// │        the opposing side, drawn with muted markers.                │
// │                                                                    │
// │  Extras that are NOT toggles:                                      │
// │   • dashboard click-to-pair — Dashboard context only, see pairEval │
// │     + DashPairCard below.                                          │
// │                                                                    │
// │  To add a page: give <MapPane context="…"> and add that key to     │
// │  ASB_MAP_LAYERS.contexts with its `home` side. Don't hand-roll a   │
// │  per-page layer object — the registry is the single source.        │
// └──────────────────────────────────────────────────────────────────┘
//
// Dependencies (loaded via CDN in Portal.html):
//   - Leaflet 1.9
//   - leaflet.markercluster 1.5
//   - Tabler Icons webfont (class="ti ti-…")
//
// Exposes: window.MapPane
// Props:
//   context (page id → home/opponent via ASB_MAP_LAYERS), cargos, vessels,
//   focusedCargo, focusedVessel, compact,
//   portFilter, onSelectCargo, onSelectVessel
//
// Layer keys actively used by this implementation: `cargo`, `vessels`.
// Zone regions/tints are no longer drawn (Map Layer Model Unification,
// Part 1). Any layer must be declared in window.ASB_MAP_LAYERS to render.

(function () {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;

  // ── Port coords (lon, lat, zone) ────────────────────────────────────
  const PORTS = {
    Constanta:       [28.66, 44.18, "B.SEA"],
    Istanbul:        [28.98, 41.01, "B.SEA"],
    Novorossiysk:    [37.78, 44.72, "B.SEA"],
    Odessa:          [30.74, 46.48, "B.SEA"],
    Izmir:           [27.14, 38.42, "E.MED"],
    Piraeus:         [23.65, 37.94, "E.MED"],
    Mersin:          [34.63, 36.81, "E.MED"],
    Iskenderun:      [36.18, 36.61, "E.MED"],
    Beirut:          [35.50, 33.89, "E.MED"],
    Alexandria:      [29.92, 31.20, "E.MED"],
    Damietta:        [31.81, 31.42, "E.MED"],
    "Port Said":     [32.30, 31.27, "E.MED"],
    Aqaba:           [34.99, 29.53, "R.SEA"],
    Yanbu:           [38.06, 24.09, "R.SEA"],
    Jeddah:          [39.18, 21.49, "R.SEA"],
    "Jebel Ali":     [55.04, 25.01, "AG"],
    Sohar:           [56.71, 24.36, "AG"],
    Fujairah:        [56.34, 25.13, "AG"],
    Mumbai:          [72.85, 19.07, "A.SEA"],
    "Dar es Salaam": [39.30, -6.80, "E.AFR"],
  };
  // L.latLng wants (lat, lng), convert.
  const portLL = (name) => {
    const p = PORTS[name];
    return p ? [p[1], p[0]] : null;
  };

  // ── Cargo helpers (duplicated locally; cards.jsx hides these) ───────
  const GRAIN_COMMODITIES = new Set([
    "Wheat", "Corn", "Barley", "Rice", "Sorghum", "Soybean", "Soybeans",
  ]);
  function cargoCategory(c) {
    if (c.commodity && GRAIN_COMMODITIES.has(c.commodity)) return "GRAIN";
    const t = (c.type || "").toLowerCase();
    if (t === "dry bulk")   return "DRY BULK";
    if (t === "break bulk") return "BREAK BULK";
    if (t === "project")    return "PROJECT";
    if (t === "liquid")     return "LIQUID";
    return (c.type || "—").toUpperCase();
  }
  function getCargoIconClass(category) {
    const unitized = ["BREAK BULK", "PROJECT"];
    return unitized.includes(category?.toUpperCase())
      ? "ti-package"
      : "ti-stack-2";
  }
  function cargoStripColor(c) {
    const d = c.laycanDays;
    if (d != null && d < 3) return "out";
    if (c.scope === "out") return "out";
    if (c.scope === "partial") return "partial";
    if (d != null && d <= 7) return "partial";
    return "in";
  }
  function shortCargoName(c) {
    const src = c.commodity || c.cargo || "";
    return src.replace(/\s*\(.+?\)\s*/g, "").trim() || src;
  }

  // ── Vessel triangle sizes by class ──────────────────────────────────
  function vesselSize(v) {
    const dwt = parseInt(String(v.dwt || "").replace(/[,\s]/g, ""), 10) || 0;
    if (dwt < 5000)   return { w: 10, h: 17 };
    if (dwt < 35000)  return { w: 12, h: 20 };
    if (dwt < 55000)  return { w: 14, h: 24 };
    return { w: 16, h: 28 };
  }
  function vesselColor(v) {
    if (v.status === "open")    return "#97C459";
    if (v.status === "review")  return "#EF9F27";
    if (v.openDateUrgency === "red" || (v.openDateDays != null && v.openDateDays < 0)) return "#E24B4A";
    if (v.status === "fixed")   return "rgba(255,255,255,0.30)";
    return "#97C459";
  }
  function vesselCourse(v) {
    if (typeof v.course === "number") return v.course;
    // deterministic stub: hash id → 0–360
    const id = String(v.id || v.name || "");
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((h % 360) + 360) % 360;
  }

  // ── divIcon HTML builders (zoom-aware) ───────────────────────────────
  // Scope → CSS-friendly hex
  const SCOPE_COLOR = { in: "#97C459", partial: "#EF9F27", out: "#E24B4A" };

  function cargoHoverTipHTML(c) {
    const qty = c.qtyMt ? `${c.qtyMt} MT` : "—";
    const route = c.route ? `${c.route.polCode} → ${c.route.podCode}` : "";
    return `<div class="cargo-hover-tip">${shortCargoName(c)} · ${qty} · ${route}</div>`;
  }

  // STATE A, Zoom ≤ 6: dot only
  function cargoDotHTML(c, selected) {
    const scope = cargoStripColor(c);
    const sel = selected ? " is-selected" : "";
    return `
      <div class="cargo-marker-wrap cargo-dot-marker${sel}" data-scope="${scope}">
        ${cargoHoverTipHTML(c)}
      </div>`;
  }

  // STATE B, Zoom 7–8: pill (dot + name, no icon)
  function cargoPillHTML(c, selected) {
    const scope = cargoStripColor(c);
    const sel = selected ? " is-selected" : "";
    return `
      <div class="cargo-marker-wrap cargo-pill-marker${sel}" data-scope="${scope}" style="border-left-color:${SCOPE_COLOR[scope]}">
        <span class="pill-dot" style="background:${SCOPE_COLOR[scope]}"></span>
        <span class="pill-name">${shortCargoName(c)}</span>
        ${cargoHoverTipHTML(c)}
      </div>`;
  }

  // STATE C, Zoom ≥ 9: thumbnail (smaller, more transparent)
  function cargoThumbHTML(c, selected) {
    const icon = getCargoIconClass(cargoCategory(c));
    const scope = cargoStripColor(c);
    const sel = selected ? " is-selected" : "";
    const wog = c.wog ? '<span class="wog-dot" title="Without Guarantee"></span>' : "";
    return `
      <div class="cargo-marker-wrap cargo-thumb-marker${sel}" data-scope="${scope}" style="border-left-color:${SCOPE_COLOR[scope]}">
        <i class="ti ${icon}"></i>
        <span>${shortCargoName(c)}</span>
        ${wog}
        ${cargoHoverTipHTML(c)}
      </div>`;
  }

  // Resolve current state from zoom.
  function cargoStateForZoom(z) {
    if (z <= 6) return "dot";
    if (z <= 8) return "pill";
    return "thumb";
  }
  function cargoIconForState(c, state, selected) {
    if (state === "dot")  return { html: cargoDotHTML(c, selected),  size: [12, 12], anchor: [6, 6] };
    if (state === "pill") return { html: cargoPillHTML(c, selected), size: [80, 14], anchor: [40, 7] };
    return                       { html: cargoThumbHTML(c, selected), size: [44, 30], anchor: [22, 30] };
  }
  function vesselTriangleHTML(v, selected, box) {
    const { w, h } = vesselSize(v);
    const colour = vesselColor(v);
    const course = vesselCourse(v);
    const sz = box || Math.max(w, h, 28);
    const wrapCls = `vessel-tri-wrap${selected ? " is-selected" : ""}`;
    return `
      <div class="${wrapCls}" style="width:${sz}px;height:${sz}px;">
        <div class="v-core">
          <div class="v-tri" style="
            border-left:${w / 2}px solid transparent;
            border-right:${w / 2}px solid transparent;
            border-bottom:${h}px solid ${colour};
            filter: drop-shadow(0 0 3px ${colour}80);
            transform: rotate(${course}deg);
          "></div>
          <div class="v-label">${v.name}</div>
        </div>
      </div>`;
  }
  function clusterIconHTML(count) {
    const size = count < 10 ? 28 : count < 50 ? 34 : 40;
    return {
      html: `<div class="asb-cluster" style="width:${size}px;height:${size}px;">${count}</div>`,
      size,
    };
  }

  // ── Cargo ↔ vessel pairing (Dashboard click-to-pair · part 5) ───────
  // Lightweight eligibility + quality label, in the spirit of the alert
  // matching engine (alerts.jsx · alQuality). Returns a LABEL only — never a
  // raw numeric score (scores must not surface on the map).
  const ZONE_ADJ = {
    "B.SEA": ["E.MED"],
    "E.MED": ["B.SEA", "R.SEA"],
    "R.SEA": ["E.MED", "AG", "A.SEA"],
    "AG":    ["R.SEA", "A.SEA"],
    "A.SEA": ["AG", "R.SEA", "E.AFR"],
    "E.AFR": ["A.SEA", "R.SEA"],
  };
  function zonesNear(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return (ZONE_ADJ[a] || []).includes(b);
  }
  function pairEval(cargo, vessel) {
    if (!cargo || !vessel) return { eligible: false, label: "Weak" };
    const dwt = parseInt(String(vessel.dwt || "").replace(/[^0-9]/g, ""), 10) || 0;
    const qty = parseInt(String(cargo.qtyMt != null ? cargo.qtyMt : "").replace(/[^0-9]/g, ""), 10) || 0;
    const canLift = qty === 0 || dwt === 0 || dwt >= qty;
    const vZone = vessel.openPortZone, cZone = cargo.route && cargo.route.polZone;
    const same = !!(vZone && cZone && vZone === cZone);
    const near = zonesNear(vZone, cZone);
    let hits = 0;
    if (same) hits += 2; else if (near) hits += 1;
    if (canLift && qty > 0 && dwt > 0) {
      const util = qty / dwt;
      if (util >= 0.4 && util <= 1) hits += 2; else hits += 1;
    } else if (canLift) hits += 1;
    if (vessel.grainCertified && /grain|wheat|corn|barley|soy/i.test(String(cargo.commodity || cargo.cargo || ""))) hits += 1;
    const eligible = canLift && near;
    let label;
    if (!canLift) label = "Weak";
    else if (hits >= 4) label = "Strong";
    else if (hits >= 3) label = "Good";
    else if (hits >= 1) label = "Possible";
    else label = "Weak";
    return { eligible, label };
  }

  // ── MapPane ─────────────────────────────────────────────────────────
  window.MapPane = function MapPane({
    context,
    cargos = [],
    vessels = [],
    focusedCargo = null,
    focusedVessel = null,
    compact = false,
    portFilter = null,
    onSelectCargo,
    onSelectVessel,
    barLeft = false,
  }) {
    // ── Home / opponent model (central registry · Part 2) ─────────────
    // Home side is always shown (locked). The opposite side is the single
    // adjustable "opponent" layer — one toggle, default OFF. The Dashboard
    // ("both") shows both sides and has no opponent toggle (pairing → Part 5).
    const REG = window.ASB_MAP_LAYERS || {};
    const homeSide = (REG.contexts && REG.contexts[context] && REG.contexts[context].home) || "both";
    const [opponentOn, setOpponentOn] = useState(false);

    const cargoOn   = homeSide === "both" || homeSide === "cargo"  || (homeSide === "vessel" && opponentOn);
    const vesselsOn = homeSide === "both" || homeSide === "vessel" || (homeSide === "cargo"  && opponentOn);
    const cargoIsOpponent  = homeSide === "vessel";
    const vesselIsOpponent = homeSide === "cargo";

    // ── Dashboard click-to-pair (part 5) — Dashboard ("both") ONLY ────
    // Click a cargo (or vessel) → anchor; eligible counterparts highlight;
    // click one → a PDA / economics pair card opens. Empty-sea click clears.
    const pairingEnabled = !!(REG.contexts && REG.contexts[context] && REG.contexts[context].pairing);
    const [pairAnchor, setPairAnchor] = useState(null);   // { kind:'cargo'|'vessel', id }
    const [pairResult, setPairResult] = useState(null);   // { cargo, vessel, label }
    const cargoById  = (id) => cargos.find((c) => c.id === id) || null;
    const vesselById = (id) => vessels.find((v) => v.id === id) || null;
    const eligibleVesselIds = (pairingEnabled && pairAnchor && pairAnchor.kind === "cargo")
      ? new Set(vessels.filter((v) => pairEval(cargoById(pairAnchor.id), v).eligible).map((v) => v.id))
      : null;
    const eligibleCargoIds = (pairingEnabled && pairAnchor && pairAnchor.kind === "vessel")
      ? new Set(cargos.filter((c) => pairEval(c, vesselById(pairAnchor.id)).eligible).map((c) => c.id))
      : null;
    const handlePairClick = (kind, id) => {
      if (!pairAnchor || pairAnchor.kind === kind) {
        setPairAnchor({ kind, id });
        setPairResult(null);
        return;
      }
      const cargo  = kind === "cargo"  ? cargoById(id)  : cargoById(pairAnchor.id);
      const vessel = kind === "vessel" ? vesselById(id) : vesselById(pairAnchor.id);
      setPairResult({ cargo, vessel, label: pairEval(cargo, vessel).label });
    };
    const clearPairing = () => { setPairAnchor(null); setPairResult(null); };

    const hostRef = useRef(null);
    const mapRef = useRef(null);
    const layersRef = useRef({}); // { route, cluster }
    const cargoMarkersRef = useRef({});  // id → L.Marker
    const vesselMarkersRef = useRef({}); // id → L.Marker

    const [fullscreen, setFullscreen] = useState(false);
    const [voyOpen, setVoyOpen] = useState(false);
    const [voyPrefill, setVoyPrefill] = useState({ cargo: null, vessel: null });
    // ── Filter sub-panel (opened from the right-bar Filters icon) ───────
    // Context-aware: a Cargo section shows when cargo markers are on, a
    // Tonnage section shows when vessel markers are on — so the dashboard
    // ("both") exposes the full set. Filters drive real marker visibility.
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [showCargoLayer, setShowCargoLayer] = useState(true);
    const [showVesselLayer, setShowVesselLayer] = useState(true);
    const [cargoSel, setCargoSel] = useState({});   // { type:  false } = hidden
    const [vesselSel, setVesselSel] = useState({});  // { class: false } = hidden
    const cargoTypeList   = useMemo(() => Array.from(new Set((cargos  || []).map((c) => c.type).filter(Boolean))), [cargos]);
    const vesselClassList = useMemo(() => Array.from(new Set((vessels || []).map((v) => v.type).filter(Boolean))), [vessels]);
    const toggleCargoType   = (t) => setCargoSel((s)  => ({ ...s, [t]: s[t] === false }));
    const toggleVesselClass = (t) => setVesselSel((s) => ({ ...s, [t]: s[t] === false }));
    const resetFilters = () => { setShowCargoLayer(true); setShowVesselLayer(true); setCargoSel({}); setVesselSel({}); };
    const [popup, setPopup] = useState(null); // { kind:'cargo'|'vessel', data, point:{x,y} }
    const [internalSelCargo, setInternalSelCargo] = useState(null);
    const [internalSelVessel, setInternalSelVessel] = useState(null);
    // Shared light/dark base theme (asb/map-shared.jsx), persisted + synced.
    const [mapBase] = window.useMapBase();
    const baseLayersRef = useRef({ base: null, seamark: null });

    // ── Initialise map once ───────────────────────────────────────────
    useEffect(() => {
      if (!hostRef.current || mapRef.current) return;
      if (typeof L === "undefined") {
        // eslint-disable-next-line no-console
        console.error("Leaflet not loaded");
        return;
      }
      const map = L.map(hostRef.current, {
        center: [24.0, 40.0],
        zoom: 4,
        minZoom: 2,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: true,
        worldCopyJump: false,
        preferCanvas: false,
      });
      // Base tiles are added by the shared base-theme effect below, so the
      // light/dark toggle can swap them live. (Offline mode skips them.)

      // Route layer (drawn on cargo focus)
      const route = L.layerGroup().addTo(map);

      // Marker cluster groups
      const cluster = L.markerClusterGroup({
        maxClusterRadius: 38,
        showCoverageOnHover: false,
        spiderfyDistanceMultiplier: 1.5,
        iconCreateFunction: (cl) => {
          const count = cl.getChildCount();
          const { html, size } = clusterIconHTML(count);
          return L.divIcon({
            html, className: "asb-cluster-wrap",
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
        },
      });
      map.addLayer(cluster);

      // Close popup / clear route on map background click
      map.on("click", () => {
        setPopup(null);
        layersRef.current.route?.clearLayers();
        setInternalSelCargo(null);
        setInternalSelVessel(null);
        setPairAnchor(null);
        setPairResult(null);
      });
      // Reposition popup on map move/zoom
      map.on("move zoom", () => {
        setPopup((p) => p ? { ...p } : p); // re-render to refresh screen coords
      });

      // Zoom-dependent cargo marker rendering (Prompt, density fix).
      map.on("zoomend", () => {
        const z = map.getZoom();
        const newState = cargoStateForZoom(z);
        Object.values(cargoMarkersRef.current).forEach((mk) => {
          if (!mk || !mk._asbCargo) return;
          if (mk._asbState === newState) return;
          const c = mk._asbCargo;
          const sel = (mk.options && mk.options._sel) || false;
          const ic = cargoIconForState(c, newState, sel);
          mk.setIcon(L.divIcon({
            html: ic.html,
            className: `cargo-marker${mk._asbOpponent ? " is-opponent" : ""}`,
            iconSize: ic.size,
            iconAnchor: ic.anchor,
          }));
          mk._asbState = newState;
        });
      });

      mapRef.current = map;
      layersRef.current = { route, cluster };

      // First-time fit covering both Med + Arabian Gulf
      setTimeout(() => {
        try {
          map.fitBounds([[12, 22], [47, 60]], { padding: [20, 20] });
        } catch (e) { /* noop */ }
      }, 50);
    }, []);

    // Tear-down map
    useEffect(() => () => {
      try { mapRef.current && mapRef.current.remove(); } catch (e) { /* noop */ }
      mapRef.current = null;
    }, []);

    // ── Shared base theme → swap Carto Voyager (light) / Dark Matter (dark)
    //    + OpenSeaMap seamark overlay on both. (asb/map-shared.jsx)
    useEffect(() => {
      const map = mapRef.current;
      if (!map || window.__ASB_OFFLINE) return;
      const T = window.ASB_MAP_TILES;
      const blr = baseLayersRef.current;
      if (blr.base)    { try { map.removeLayer(blr.base); }    catch (e) {} }
      if (blr.seamark) { try { map.removeLayer(blr.seamark); } catch (e) {} }
      blr.base = L.tileLayer(mapBase === "dark" ? T.dark : T.light, {
        attribution: T.attribution, maxZoom: 18, subdomains: T.subdomains,
      }).addTo(map);
      try { blr.base.bringToBack(); } catch (e) {}
      blr.seamark = L.tileLayer(T.seamark, { maxZoom: 18, opacity: 0.6 }).addTo(map);
    }, [mapBase]);

    // ── Build / refresh cargo + vessel markers ────────────────────────
    useEffect(() => {
      const cluster = layersRef.current.cluster;
      if (!cluster || !mapRef.current) return;
      cluster.clearLayers();
      cargoMarkersRef.current = {};
      vesselMarkersRef.current = {};

      if (cargoOn && showCargoLayer) {
        const z = mapRef.current.getZoom();
        const state = cargoStateForZoom(z);
        cargos.filter((c) => cargoSel[c.type] !== false).forEach((c) => {
          const ll = portLL(c.route?.polName);
          if (!ll) return;
          // Tiny per-cargo jitter so markers at the same port don't perfectly stack
          // (the cluster plugin handles overlap, but we still want a small spread).
          const jx = ((c.id || "").charCodeAt(0) % 7) * 0.04 - 0.12;
          const jy = ((c.id || "").charCodeAt(1) % 7) * 0.04 - 0.12;
          const sel = internalSelCargo === c.id || focusedCargo?.id === c.id;
          const ic = cargoIconForState(c, state, sel);
          // Pairing highlight classes (dashboard click-to-pair, part 5)
          let pairCls = "";
          if (pairingEnabled && pairAnchor) {
            if (pairAnchor.kind === "cargo" && pairAnchor.id === c.id) pairCls = " is-anchor";
            else if (eligibleCargoIds) pairCls = eligibleCargoIds.has(c.id) ? " is-eligible" : " is-faded";
            else pairCls = " is-faded";
          }
          const marker = L.marker([ll[0] + jy, ll[1] + jx], {
            icon: L.divIcon({
              html: ic.html,
              className: `cargo-marker${cargoIsOpponent ? " is-opponent" : ""}${pairCls}`,
              iconSize: ic.size,
              iconAnchor: ic.anchor,
            }),
            riseOnHover: true,
          });
          marker._asbCargo = c;
          marker._asbState = state;
          marker._asbOpponent = cargoIsOpponent;
          marker.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            if (pairingEnabled) { handlePairClick("cargo", c.id); return; }
            setInternalSelCargo(c.id);
            setInternalSelVessel(null);
            const p = mapRef.current.latLngToContainerPoint(marker.getLatLng());
            setPopup({ kind: "cargo", data: c, point: { x: p.x, y: p.y } });
          });
          cargoMarkersRef.current[c.id] = marker;
          cluster.addLayer(marker);
        });
      }

      if (vesselsOn && showVesselLayer) {
        vessels.filter((v) => vesselSel[v.type] !== false).forEach((v) => {
          const ll = portLL(v.openPort);
          if (!ll) return;
          const jx = ((v.id || "").charCodeAt(0) % 7) * 0.05 - 0.15;
          const jy = ((v.id || "").charCodeAt(1) % 7) * 0.05 - 0.15;
          const sel = internalSelVessel === v.id || focusedVessel?.id === v.id;
          const { w, h } = vesselSize(v);
          const box = Math.max(w, h, 28);
          // Pairing highlight classes (dashboard click-to-pair, part 5)
          let pairCls = "";
          if (pairingEnabled && pairAnchor) {
            if (pairAnchor.kind === "vessel" && pairAnchor.id === v.id) pairCls = " is-anchor";
            else if (eligibleVesselIds) pairCls = eligibleVesselIds.has(v.id) ? " is-eligible" : " is-faded";
            else pairCls = " is-faded";
          }
          const marker = L.marker([ll[0] + jy, ll[1] + jx], {
            icon: L.divIcon({
              html: vesselTriangleHTML(v, sel, box),
              className: `vessel-marker${vesselIsOpponent ? " is-opponent" : ""}${pairCls}`,
              iconSize: [box, box],
              iconAnchor: [box / 2, box / 2],
            }),
            riseOnHover: true,
          });
          marker.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            if (pairingEnabled) { handlePairClick("vessel", v.id); return; }
            setInternalSelVessel(v.id);
            setInternalSelCargo(null);
            const p = mapRef.current.latLngToContainerPoint(marker.getLatLng());
            setPopup({ kind: "vessel", data: v, point: { x: p.x, y: p.y } });
          });
          vesselMarkersRef.current[v.id] = marker;
          cluster.addLayer(marker);
        });
      }
    }, [cargos, vessels, cargoOn, vesselsOn, showCargoLayer, showVesselLayer, cargoSel, vesselSel, cargoIsOpponent, vesselIsOpponent, internalSelCargo, internalSelVessel, focusedCargo?.id, focusedVessel?.id, pairingEnabled, pairAnchor]);

    // ── Focused cargo → draw route + fit bounds ───────────────────────
    useEffect(() => {
      const map = mapRef.current;
      const route = layersRef.current.route;
      if (!map || !route) return;
      route.clearLayers();
      if (!focusedCargo) return;
      const pol = portLL(focusedCargo.route?.polName);
      const pod = portLL(focusedCargo.route?.podName);
      if (!pol || !pod) return;
      L.polyline([pol, pod], {
        color: "#185FA5",
        weight: 1.8,
        dashArray: "6 5",
        opacity: 0.85,
      }).addTo(route);
      L.circleMarker(pol, {
        radius: 6, color: "#97C459", fill: false, weight: 1.8,
      }).addTo(route);
      L.circleMarker(pod, {
        radius: 6, color: "#E24B4A", fill: false, weight: 1.8,
      }).addTo(route);
      map.fitBounds([pol, pod], { padding: [80, 80], maxZoom: 7, animate: true, duration: 0.8 });
    }, [focusedCargo?.id]);

    // ── Focused vessel → flyTo ────────────────────────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !focusedVessel) return;
      const ll = portLL(focusedVessel.openPort);
      if (!ll) return;
      map.flyTo(ll, 7, { duration: 1.2 });
    }, [focusedVessel?.id]);

    // ── Invalidate map size when layout changes ───────────────────────
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const t = setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 240);
      return () => clearTimeout(t);
    }, [fullscreen, voyOpen, compact]);

    // ── Re-emit cargo/vessel select up to host ────────────────────────
    useEffect(() => {
      if (internalSelCargo && onSelectCargo) {
        const c = cargos.find((x) => x.id === internalSelCargo);
        if (c) onSelectCargo(c);
      }
    }, [internalSelCargo]);
    useEffect(() => {
      if (internalSelVessel && onSelectVessel) {
        const v = vessels.find((x) => x.id === internalSelVessel);
        if (v) onSelectVessel(v);
      }
    }, [internalSelVessel]);

    // ── Popup actions ─────────────────────────────────────────────────
    const onPopupAction = (action) => {
      if (!popup) return;
      const { kind, data } = popup;
      if (action === "view") {
        if (kind === "cargo" && onSelectCargo) onSelectCargo(data);
        if (kind === "vessel" && onSelectVessel) onSelectVessel(data);
        setPopup(null);
        return;
      }
      if (action === "voy") {
        setVoyPrefill((s) => kind === "cargo"
          ? { ...s, cargo: data }
          : { ...s, vessel: data });
        setVoyOpen(true);
        setPopup(null);
        return;
      }
      if (action === "match") {
        // Surface the matching flow via existing handler; no separate UI.
        if (kind === "cargo" && onSelectCargo) onSelectCargo(data);
        if (kind === "vessel" && onSelectVessel) onSelectVessel(data);
        setPopup(null);
        return;
      }
    };

    // ── Tier gating (Voyage Estimator) ─────────────────────────────────
    const tier = (typeof window.useViewerTier === "function") ? window.useViewerTier() : "T3";
    const voyLocked = tier === "T1" || tier === "T2";

    return (
      <div className={`asb-map base-${mapBase}${barLeft ? " bar-inner-left" : ""}${fullscreen ? " is-fullscreen" : ""}`}>
        {/* ── MAP CANVAS ────────────────────────────────── */}
        <div className="map-canvas">
          <div ref={hostRef} className="leaflet-host" />

          {/* Layer control (bottom): the home side is locked-on; the ONE
              adjustable toggle reveals the opposing side. Default OFF.
              Dashboard ("both") shows both sides, no toggle (pairing → Part 5). */}
          <div className="layer-strip">
            {(homeSide === "cargo" || homeSide === "both") && (
              <div className="layer-pill on is-locked" title="Cargo positions — always shown">
                <span className="pill-dot" style={{ background: "#97C459" }}></span> Cargo
              </div>
            )}
            {(homeSide === "vessel" || homeSide === "both") && (
              <div className="layer-pill on is-locked" title="Open tonnage — always shown">
                <span className="pill-tri" style={{ borderBottom: "7px solid #7BB8F0" }}></span> Tonnage
              </div>
            )}
            {homeSide !== "both" && (
              <div
                className={`layer-pill opp ${opponentOn ? "on" : "off"}`}
                onClick={() => setOpponentOn((o) => !o)}
                title={homeSide === "cargo" ? "Show open tonnage" : "Show open cargo"}
              >
                <span
                  className={homeSide === "cargo" ? "pill-tri" : "pill-dot"}
                  style={homeSide === "cargo" ? { borderBottom: "7px solid #7BB8F0" } : { background: "#97C459" }}
                ></span>
                {opponentOn
                  ? (homeSide === "cargo" ? "Tonnage" : "Cargo")
                  : (homeSide === "cargo" ? "Show tonnage" : "Show cargo")}
              </div>
            )}
          </div>

          {/* Custom popup */}
          {popup && (
            <MapPopup
              popup={popup}
              onClose={() => setPopup(null)}
              onAction={onPopupAction}
            />
          )}

          {/* Click-to-pair hint + result card (Dashboard only · part 5) */}
          {pairingEnabled && pairAnchor && !pairResult && (
            <div className="dash-pair-hint" onClick={(e) => e.stopPropagation()}>
              <span className="dash-pair-hint__dot" />
              {pairAnchor.kind === "cargo"
                ? <>Cargo anchored — click a <strong>highlighted vessel</strong> to estimate the pairing</>
                : <>Vessel anchored — click a <strong>highlighted cargo</strong> to estimate the pairing</>}
              <button type="button" onClick={clearPairing} aria-label="Clear">✕</button>
            </div>
          )}
          {pairingEnabled && pairResult && (
            <DashPairCard
              pair={pairResult}
              onClose={clearPairing}
              onOpenEstimator={() => {
                if (window.openVoyageEstimator) {
                  window.openVoyageEstimator(pairResult.vessel?.id, pairResult.cargo?.id);
                }
              }}
            />
          )}
        </div>

        {/* ── FILTER SUB-PANEL ──────────────────────────── */}
        <div className={`filter-panel${filtersOpen ? " open" : ""}`}>
          <div className="filter-panel__inner">
            <div className="filter-panel__head">
              <i className="ti ti-adjustments-horizontal"></i>
              <div className="filter-panel__title">Filters</div>
              <button className="filter-panel__close" onClick={() => setFiltersOpen(false)} aria-label="Close">
                <i className="ti ti-x"></i>
              </button>
            </div>

            {cargoOn && (
              <div className="fp-section">
                <div className="fp-section__head">
                  <span className="fp-dot" style={{ background: "#97C459" }}></span>
                  <span className="fp-section__title">Cargo positions</span>
                  <button
                    className={`fp-switch${showCargoLayer ? " on" : ""}`}
                    onClick={() => setShowCargoLayer((v) => !v)}
                    aria-label="Toggle cargo layer"
                  ><span className="fp-switch__knob"></span></button>
                </div>
                <div className={`fp-chips${showCargoLayer ? "" : " is-muted"}`}>
                  {cargoTypeList.map((t) => (
                    <button
                      key={t}
                      className={`fp-chip${cargoSel[t] !== false ? " on" : ""}`}
                      disabled={!showCargoLayer}
                      onClick={() => toggleCargoType(t)}
                    >{t}</button>
                  ))}
                </div>
              </div>
            )}

            {vesselsOn && (
              <div className="fp-section">
                <div className="fp-section__head">
                  <span className="fp-tri"></span>
                  <span className="fp-section__title">Open tonnage</span>
                  <button
                    className={`fp-switch${showVesselLayer ? " on" : ""}`}
                    onClick={() => setShowVesselLayer((v) => !v)}
                    aria-label="Toggle tonnage layer"
                  ><span className="fp-switch__knob"></span></button>
                </div>
                <div className={`fp-chips${showVesselLayer ? "" : " is-muted"}`}>
                  {vesselClassList.map((t) => (
                    <button
                      key={t}
                      className={`fp-chip${vesselSel[t] !== false ? " on" : ""}`}
                      disabled={!showVesselLayer}
                      onClick={() => toggleVesselClass(t)}
                    >{t}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="fp-foot">
              <button className="fp-reset" onClick={resetFilters}>
                <i className="ti ti-rotate-2"></i> Reset filters
              </button>
            </div>
          </div>
        </div>

        {/* ── VOY OPEX PANEL ────────────────────────────── */}
        {!voyLocked && (
          <VoyOpexPanel
            open={voyOpen}
            onClose={() => setVoyOpen(false)}
            cargo={voyPrefill.cargo}
            vessel={voyPrefill.vessel}
          />
        )}

        {/* ── SINGLE RIGHT BAR (Amendment 01) ───────────── */}
        <div className="right-bar">
          <div
            className={`voy-opex-icon${voyOpen && !voyLocked ? " active" : ""}${voyLocked ? " is-locked" : ""}`}
            onClick={() => { if (voyLocked) return; setFiltersOpen(false); setVoyOpen((o) => !o); }}
          >
            <i className="ti ti-calculator"></i>
            <span className="tooltip-l">
              {voyLocked ? "Voy OPEX Estimator · Available from Subscriber tier" : "Voy OPEX Estimator"}
            </span>
          </div>
          <div className="bar-divider" />
          <div
            className={`bar-icon${filtersOpen ? " active" : ""}`}
            title="Filters"
            onClick={() => { setVoyOpen(false); setFiltersOpen((o) => !o); }}
          >
            <i className="ti ti-adjustments-horizontal"></i>
            <span className="tooltip-l">Filters</span>
          </div>
          <div className="bar-icon" title="Search">
            <i className="ti ti-search"></i>
            <span className="tooltip-l">Search</span>
          </div>
          <div className="bar-spacer" />
          <div className="bar-divider" />
          <MapBaseToggle mode="icon" />
          <div className="bar-icon" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <i className="ti ti-plus"></i>
            <span className="tooltip-l">Zoom in</span>
          </div>
          <div className="bar-icon" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <i className="ti ti-minus"></i>
            <span className="tooltip-l">Zoom out</span>
          </div>
          <div className="bar-icon" title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={() => setFullscreen((f) => !f)}>
            <i className={`ti ${fullscreen ? "ti-minimize" : "ti-maximize"}`}></i>
            <span className="tooltip-l">{fullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
          </div>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════════
  //  Map popup (custom, replaces leaflet default)
  // ══════════════════════════════════════════════════════════════════
  // ═════════════════════════════════════════════════════════════════
  //  Dashboard pair card (click-to-pair result · part 5)
  //  Shows the quality LABEL (never a raw score) + a compact economics
  //  read-out for the chosen cargo↔vessel pair. No counterparty contact
  //  details are ever rendered (firewall).
  // ═════════════════════════════════════════════════════════════════
  function DashPairCard({ pair, onClose, onOpenEstimator }) {
    const { cargo, vessel, label } = pair || {};
    if (!cargo || !vessel) return null;
    const stop = (e) => e.stopPropagation();
    const dwt = parseInt(String(vessel.dwt || "").replace(/[^0-9]/g, ""), 10) || 0;
    const qty = parseInt(String(cargo.qtyMt != null ? cargo.qtyMt : "").replace(/[^0-9]/g, ""), 10) || 0;
    const util = (dwt && qty) ? Math.round((qty / dwt) * 100) : null;
    const qClass = label === "Strong" ? "in" : label === "Good" ? "blue" : label === "Possible" ? "review" : "muted";
    const ballast = (vessel.openPortZone && cargo.route && cargo.route.polZone)
      ? `${vessel.openPortZone} → ${cargo.route.polZone}` : "—";
    const route = cargo.route ? `${cargo.route.polCode} → ${cargo.route.podCode}` : "—";
    return (
      <div className="dash-pair-card" onClick={stop} onMouseDown={stop}>
        <button className="dash-pair-card__close" onClick={onClose} aria-label="Clear pairing">×</button>
        <div className="dash-pair-card__head">
          <span className="dash-pair-card__eyebrow">Pairing · PDA estimate</span>
          <span className={`asb-badge ${qClass}`}>{label}</span>
        </div>
        <div className="dash-pair-card__pair">
          <span className="dash-pair-card__cargo">{cargo.cargo}</span>
          <span className="dash-pair-card__arrow">→</span>
          <span className="dash-pair-card__vessel">{vessel.name}</span>
        </div>
        <div className="dash-pair-card__grid">
          <div><div className="dash-pair-card__k">Route</div><div className="dash-pair-card__v mono">{route}</div></div>
          <div><div className="dash-pair-card__k">Lift</div><div className="dash-pair-card__v">{qty ? `${qty.toLocaleString()} MT` : "—"}{util != null ? ` · ${util}% DWT` : ""}</div></div>
          <div><div className="dash-pair-card__k">Ballast</div><div className="dash-pair-card__v">{ballast}</div></div>
          <div><div className="dash-pair-card__k">Laycan</div><div className="dash-pair-card__v">{cargo.spot ? "SPOT" : (cargo.laycanFrom ? cargo.laycanFrom.split(" ").slice(0, 2).join(" ") : "—")}</div></div>
        </div>
        <button className="dash-pair-card__btn" onClick={onOpenEstimator}>Open full Voy OPEX / PDA →</button>
      </div>
    );
  }

  function MapPopup({ popup, onClose, onAction }) {
    const { kind, data, point } = popup;
    const stop = (e) => e.stopPropagation();
    const style = {
      left: point.x,
      top: point.y - 30,
    };
    if (kind === "cargo") {
      const c = data;
      const laycan = (c.laycanFrom && c.laycanTo)
        ? `${c.laycanFrom.split(" ").slice(0,2).join(" ")} – ${c.laycanTo.split(" ").slice(0,2).join(" ")}`
        : "—";
      return (
        <div className="map-popup" style={style} onClick={stop} onMouseDown={stop}>
          <button className="map-popup__close" onClick={onClose}>×</button>
          <div className="map-popup__title">{c.cargo}</div>
          <div className="map-popup__sub">
            {c.route?.polCode} → {c.route?.podCode} · {c.route?.polZone} → {c.route?.podZone}
          </div>
          <div className="map-popup__grid">
            <div>
              <div className="map-popup__k">QTY</div>
              <div className="map-popup__v">{c.qtyMt} MT</div>
            </div>
            <div>
              <div className="map-popup__k">LAYCAN</div>
              <div className="map-popup__v">{laycan}</div>
            </div>
            <div>
              <div className="map-popup__k">TERMS</div>
              <div className="map-popup__v">{c.loadTerms || "—"}</div>
            </div>
            <div>
              <div className="map-popup__k">SF</div>
              <div className="map-popup__v">{c.sf != null ? `${c.sf} m³/t` : "—"}</div>
            </div>
          </div>
          <div className="map-popup__actions">
            <button className="map-popup__btn map-popup__btn--view"  onClick={() => onAction("view")}>View card</button>
            <button className="map-popup__btn map-popup__btn--voy"   onClick={() => onAction("voy")}>Voy OPEX</button>
            <button className="map-popup__btn map-popup__btn--match" onClick={() => onAction("match")}>Match</button>
          </div>
        </div>
      );
    }
    // Vessel popup
    const v = data;
    const cap = v.dwt;
    const capLabel = "DWT";
    return (
      <div className="map-popup" style={style} onClick={stop} onMouseDown={stop}>
        <button className="map-popup__close" onClick={onClose}>×</button>
        <div className="map-popup__title">{v.name}</div>
        <div className="map-popup__sub">{v.type} · {v.flag} · Built {v.built}</div>
        <div className="map-popup__grid">
          <div>
            <div className="map-popup__k">{capLabel}</div>
            <div className="map-popup__v">{cap} MT</div>
          </div>
          <div>
            <div className="map-popup__k">DRAFT</div>
            <div className="map-popup__v">{v.draft || "—"}</div>
          </div>
          <div>
            <div className="map-popup__k">OPEN PORT</div>
            <div className="map-popup__v">{v.openPort}</div>
          </div>
          <div>
            <div className="map-popup__k">OPEN DATE</div>
            <div className="map-popup__v">{v.openDate}</div>
          </div>
        </div>
        <div className="map-popup__actions">
          <button className="map-popup__btn map-popup__btn--view"  onClick={() => onAction("view")}>View card</button>
          <button className="map-popup__btn map-popup__btn--voy"   onClick={() => onAction("voy")}>Voy OPEX</button>
          <button className="map-popup__btn map-popup__btn--match" onClick={() => onAction("match")}>Match</button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  Voy OPEX panel, 4 module tabs, live totals
  // ══════════════════════════════════════════════════════════════════
  function VoyOpexPanel({ open, onClose, cargo, vessel }) {
    const [tab, setTab] = useState("dasa");
    // ── Include/exclude pills: which cost groups feed the estimate ──────
    // Voyage economics = Bunker + Load/Disch · PDAs = Port DAs · Suez.
    const [groups, setGroups] = useState({ pdas: true, voyeco: true, suez: true });
    const TAB_GROUP = { dasa: "pdas", bunker: "voyeco", ld: "voyeco", suez: "suez" };
    const TAB_ORDER = ["dasa", "bunker", "ld", "suez"];
    const tabEnabled = (t) => !!groups[TAB_GROUP[t]];
    const toggleGroup = (g) => setGroups((s) => ({ ...s, [g]: !s[g] }));
    useEffect(() => {
      if (!tabEnabled(tab)) {
        const first = TAB_ORDER.find(tabEnabled);
        if (first) setTab(first);
      }
    }, [groups]);

    // Module 1, Port DAs
    const [dasa, setDasa] = useState({
      loadDues: 8200,  loadAgency: 3500,  loadPilot: 4600,
      dischDues: 9400, dischAgency: 3800, dischPilot: 5200,
    });
    useEffect(() => {
      // Slight reseed when cargo changes, keep mock totals plausible.
      if (!cargo) return;
      setDasa((d) => ({ ...d }));
    }, [cargo?.id]);
    const dasaTotal = Object.values(dasa).reduce((a, b) => a + (+b || 0), 0);

    // Module 2, Bunker
    const [bunker, setBunker] = useState({
      vlsfoSea: 22, lsmgoPort: 0.5,
      vlsfoPrice: 585, lsmgoPrice: 735,
      seaDays: 10, portDays: 4,
    });
    useEffect(() => {
      if (!vessel) return;
      setBunker((b) => ({
        ...b,
        vlsfoSea:  Number(vessel.fuel?.vlsfoSea)  || b.vlsfoSea,
        lsmgoPort: Number(vessel.fuel?.lsmgoPort) || b.lsmgoPort,
      }));
    }, [vessel?.id]);
    const bunkerTotal = Math.round(
      (bunker.vlsfoSea * bunker.seaDays * bunker.vlsfoPrice) +
      (bunker.lsmgoPort * bunker.portDays * bunker.lsmgoPrice)
    );

    // Module 3, Load / Discharge
    const [ld, setLd] = useState({
      loadRate: 1200, qty: 5000, terms: "FIOST", dischRate: 1500, laytime: 96,
    });
    useEffect(() => {
      if (!cargo) return;
      const qtyNum = parseInt(String(cargo.qtyMt || "0").replace(/[,\s]/g, ""), 10);
      setLd((s) => ({
        ...s,
        loadRate: cargo.loadRate || s.loadRate,
        dischRate: cargo.dischRate || s.dischRate,
        qty: qtyNum || s.qty,
        terms: cargo.loadTerms || s.terms,
      }));
    }, [cargo?.id]);
    const ldPortDays = (() => {
      const loadDays  = ld.loadRate  > 0 ? ld.qty / ld.loadRate  : 0;
      const dischDays = ld.dischRate > 0 ? ld.qty / ld.dischRate : 0;
      return +(loadDays + dischDays).toFixed(1);
    })();

    // Module 4, Suez
    const [suez, setSuez] = useState({
      dir: "Southbound", grt: 28500, net: 17800, sca: 185420, misc: 12500, transit: 1,
    });
    const suezTotal = (+suez.sca || 0) + (+suez.misc || 0);

    // Run
    const onRun = () => {
      // No backend, just acknowledge — only enabled cost groups are included.
      const lines = [];
      if (groups.pdas)   lines.push(`Port DAs:  $${dasaTotal.toLocaleString()}`);
      if (groups.voyeco) lines.push(`Bunkers:   $${bunkerTotal.toLocaleString()}`);
      if (groups.voyeco) lines.push(`Port days: ${ldPortDays} d`);
      if (groups.suez)   lines.push(`Suez:      $${suezTotal.toLocaleString()}`);
      // eslint-disable-next-line no-alert
      alert(`Voy OPEX estimate stored.\n\n${lines.join("\n") || "No cost groups selected."}`);
    };

    return (
      <div className={`voy-panel${open ? " open" : ""}`}>
        <div className="voy-panel__inner">
          <div className="voy-panel__head">
            <i className="ti ti-calculator"></i>
            <div className="voy-panel__title">Voy OPEX Estimator</div>
            <button className="voy-panel__close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x"></i>
            </button>
          </div>

          {/* Pre-fill slots */}
          <div className={`prefill-slot${vessel ? " filled" : ""}`}>
            <div className="slot-label">Vessel</div>
            {vessel ? (
              <>
                <div className="slot-value">{vessel.name}</div>
                <div className="slot-sub">{vessel.type} · {vessel.dwt} MT</div>
              </>
            ) : (
              <div className="slot-hint">Click vessel triangle on map to fill</div>
            )}
          </div>
          <div className={`prefill-slot${cargo ? " filled" : ""}`}>
            <div className="slot-label">Cargo</div>
            {cargo ? (
              <>
                <div className="slot-value">{cargo.cargo}</div>
                <div className="slot-sub">
                  {cargo.route?.polCode} → {cargo.route?.podCode} · {cargo.qtyMt} MT
                </div>
              </>
            ) : (
              <div className="slot-hint">Click cargo thumbnail on map to fill</div>
            )}
          </div>

          {/* Cost-group include pills (on/off) */}
          <div className="voy-groups">
            <button className={`voy-grouppill${groups.voyeco ? " on" : ""}`} onClick={() => toggleGroup("voyeco")} aria-pressed={groups.voyeco}>
              <span className="voy-grouppill__tick"></span> Voyage economics
            </button>
            <button className={`voy-grouppill${groups.pdas ? " on" : ""}`} onClick={() => toggleGroup("pdas")} aria-pressed={groups.pdas}>
              <span className="voy-grouppill__tick"></span> PDAs
            </button>
            <button className={`voy-grouppill${groups.suez ? " on" : ""}`} onClick={() => toggleGroup("suez")} aria-pressed={groups.suez}>
              <span className="voy-grouppill__tick"></span> Suez
            </button>
          </div>

          {/* Module tabs (only the enabled groups) */}
          <div className="mod-tabs">
            {tabEnabled("dasa") && (
              <div className={`mod-tab${tab === "dasa" ? " active" : ""}`}   onClick={() => setTab("dasa")}>
                <i className="ti ti-building-bank"></i> Port DAs
              </div>
            )}
            {tabEnabled("bunker") && (
              <div className={`mod-tab${tab === "bunker" ? " active" : ""}`} onClick={() => setTab("bunker")}>
                <i className="ti ti-flame"></i> Bunker
              </div>
            )}
            {tabEnabled("ld") && (
              <div className={`mod-tab${tab === "ld" ? " active" : ""}`}     onClick={() => setTab("ld")}>
                <i className="ti ti-arrows-up-down"></i> Load / Disch
              </div>
            )}
            {tabEnabled("suez") && (
              <div className={`mod-tab${tab === "suez" ? " active" : ""}`}   onClick={() => setTab("suez")}>
                <i className="ti ti-wave-sine"></i> Suez Canal
              </div>
            )}
          </div>

          {/* Body */}
          <div className="voy-panel__body">
            {!TAB_ORDER.some(tabEnabled) && (
              <div className="voy-empty">Select at least one cost group above to build an estimate.</div>
            )}
            {tab === "dasa" && tabEnabled("dasa") && (
              <>
                <div className="sec-block">
                  <div className="sec-title">Load port, {cargo?.route?.polCode || "—"}</div>
                  <NumField label="Port dues (USD)"      val={dasa.loadDues}   onChange={(v) => setDasa((s) => ({ ...s, loadDues: v }))} />
                  <NumField label="Agency fee (USD)"     val={dasa.loadAgency} onChange={(v) => setDasa((s) => ({ ...s, loadAgency: v }))} />
                  <NumField label="Pilotage + towage"    val={dasa.loadPilot}  onChange={(v) => setDasa((s) => ({ ...s, loadPilot: v }))} />
                </div>
                <div className="sec-block">
                  <div className="sec-title">Discharge port, {cargo?.route?.podCode || "—"}</div>
                  <NumField label="Port dues (USD)"      val={dasa.dischDues}   onChange={(v) => setDasa((s) => ({ ...s, dischDues: v }))} />
                  <NumField label="Agency fee (USD)"     val={dasa.dischAgency} onChange={(v) => setDasa((s) => ({ ...s, dischAgency: v }))} />
                  <NumField label="Pilotage + towage"    val={dasa.dischPilot}  onChange={(v) => setDasa((s) => ({ ...s, dischPilot: v }))} />
                </div>
                <div className="total-row">
                  <span className="total-label">Total Port DAs</span>
                  <span className="total-value">${dasaTotal.toLocaleString()}</span>
                </div>
              </>
            )}

            {tab === "bunker" && tabEnabled("bunker") && (
              <>
                <div className="sec-block">
                  <div className="sec-title">Consumption</div>
                  <div className="voy-row">
                    <NumField label="VLSFO sea (MT/d)"  val={bunker.vlsfoSea}  onChange={(v) => setBunker((s) => ({ ...s, vlsfoSea: v }))} inline />
                    <NumField label="LSMGO port (MT/d)" val={bunker.lsmgoPort} onChange={(v) => setBunker((s) => ({ ...s, lsmgoPort: v }))} step="0.1" inline />
                  </div>
                </div>
                <div className="sec-block">
                  <div className="sec-title">Prices (live)</div>
                  <div className="voy-row">
                    <NumField label="VLSFO ($/MT)"  val={bunker.vlsfoPrice}  onChange={(v) => setBunker((s) => ({ ...s, vlsfoPrice: v }))} inline />
                    <NumField label="LSMGO ($/MT)"  val={bunker.lsmgoPrice}  onChange={(v) => setBunker((s) => ({ ...s, lsmgoPrice: v }))} inline />
                  </div>
                </div>
                <div className="sec-block">
                  <div className="sec-title">Voyage</div>
                  <div className="voy-row">
                    <NumField label="Sea days"   val={bunker.seaDays}  onChange={(v) => setBunker((s) => ({ ...s, seaDays: v }))} inline />
                    <NumField label="Port days"  val={bunker.portDays} onChange={(v) => setBunker((s) => ({ ...s, portDays: v }))} inline />
                  </div>
                </div>
                <div className="total-row">
                  <span className="total-label">Total Bunker Cost</span>
                  <span className="total-value">${bunkerTotal.toLocaleString()}</span>
                </div>
              </>
            )}

            {tab === "ld" && tabEnabled("ld") && (
              <>
                <div className="sec-block">
                  <div className="sec-title">Load port</div>
                  <div className="voy-row">
                    <NumField label="L/D rate (MT/d)" val={ld.loadRate} onChange={(v) => setLd((s) => ({ ...s, loadRate: v }))} inline />
                    <NumField label="Quantity (MT)"   val={ld.qty}      onChange={(v) => setLd((s) => ({ ...s, qty: v }))} inline />
                  </div>
                  <div className="voy-row one">
                    <TextField label="Terms" val={ld.terms} onChange={(v) => setLd((s) => ({ ...s, terms: v }))} />
                  </div>
                </div>
                <div className="sec-block">
                  <div className="sec-title">Discharge port</div>
                  <div className="voy-row">
                    <NumField label="L/D rate (MT/d)"  val={ld.dischRate} onChange={(v) => setLd((s) => ({ ...s, dischRate: v }))} inline />
                    <NumField label="Laytime (hours)"  val={ld.laytime}   onChange={(v) => setLd((s) => ({ ...s, laytime: v }))} inline />
                  </div>
                </div>
                <div className="total-row">
                  <span className="total-label">Estimated port days</span>
                  <span className="total-value">{ldPortDays} d</span>
                </div>
              </>
            )}

            {tab === "suez" && tabEnabled("suez") && (
              <>
                <div className="sec-block">
                  <div className="sec-title">Transit</div>
                  <div className="voy-row one">
                    <div className="voy-field">
                      <div className="voy-label">Direction</div>
                      <select className="voy-input"
                        value={suez.dir}
                        onChange={(e) => setSuez((s) => ({ ...s, dir: e.target.value }))}>
                        <option>Northbound</option>
                        <option>Southbound</option>
                      </select>
                    </div>
                  </div>
                  <div className="voy-row">
                    <NumField label="GRT"          val={suez.grt} onChange={(v) => setSuez((s) => ({ ...s, grt: v }))} inline />
                    <NumField label="Net tonnage"  val={suez.net} onChange={(v) => setSuez((s) => ({ ...s, net: v }))} inline />
                  </div>
                </div>
                <div className="sec-block">
                  <div className="sec-title">Costs</div>
                  <div className="voy-row">
                    <NumField label="SCA dues (USD)"      val={suez.sca}  onChange={(v) => setSuez((s) => ({ ...s, sca: v }))} inline />
                    <NumField label="Mooring / misc"      val={suez.misc} onChange={(v) => setSuez((s) => ({ ...s, misc: v }))} inline />
                  </div>
                  <div className="voy-row one">
                    <NumField label="Transit days" val={suez.transit} onChange={(v) => setSuez((s) => ({ ...s, transit: v }))} />
                  </div>
                </div>
                <div className="total-row">
                  <span className="total-label">Total Suez Cost</span>
                  <span className="total-value">${suezTotal.toLocaleString()}</span>
                </div>
              </>
            )}

            <button className="run-btn" onClick={onRun}>
              Run Full OPEX Estimate →
            </button>
            <div className="run-foot">T3 / T4 subscribers · All data encrypted</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Form helpers ────────────────────────────────────────────────────
  function NumField({ label, val, onChange, step, inline }) {
    return (
      <div className="voy-field" style={inline ? undefined : { marginBottom: 6 }}>
        <div className="voy-label">{label}</div>
        <input
          className="voy-input"
          type="number"
          step={step || 1}
          value={val}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
        />
      </div>
    );
  }
  function TextField({ label, val, onChange }) {
    return (
      <div className="voy-field">
        <div className="voy-label">{label}</div>
        <input
          className="voy-input"
          type="text"
          value={val}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
})();
