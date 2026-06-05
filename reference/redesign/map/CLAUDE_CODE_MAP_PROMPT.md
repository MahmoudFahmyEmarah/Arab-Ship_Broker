# Claude Code — Arab ShipBroker map: port the current map functions

You are porting the **approved map prototype** into the **real Arab ShipBroker
codebase** (Next.js + Supabase). This bundle contains the prototype map files
(plain-React/Babel running inside `Portal.html`). Treat them as the **source of
truth for behaviour, layout, copy and the layer model**, and translate them into
the production app’s real React components, hooks and CSS. Do **not** copy the
Babel/`window.*` global pattern into production.

Bundle:

| File | What it is |
|---|---|
| `asb/map.jsx` | `MapPane` — the one map component (Leaflet), markers, popups, fullscreen, filter panel, Voy OPEX |
| `asb/map-shared.jsx` | Shared layer **registry**, tile config, zone palette, light/dark base toggle |
| `asb/map-overlays.jsx` | Map chrome overlays (layer pills, etc.) |
| `asb/map.css` | All map styling |

**Runtime deps (load before the map):** Leaflet 1.9, `leaflet.markercluster`
1.5, and the Tabler Icons webfont (`class="ti ti-…"`). See the `<head>` of
`Portal.html` for the exact CDN tags.

---

## The model (read first)

There is **one** map component (`MapPane`) used by every page. What it draws is
decided by **one registry**: `window.ASB_MAP_LAYERS` in `map-shared.jsx`. Nothing
renders unless it’s declared there.

- **Base tier** (locked, identical everywhere): Carto basemap (Voyager light /
  Dark Matter dark) + OpenSeaMap seamark overlay + the light/dark toggle.
- **Home side** (locked on): each page declares its `home` in
  `ASB_MAP_LAYERS.contexts` — cargo pages show cargo, vessel pages show vessels,
  the dashboard shows both.
- **Opponent layer** (the one adjustable toggle, OFF by default): the opposing
  side, drawn with muted markers.
- **Dashboard click-to-pair** (dashboard context only): click a cargo → eligible
  vessels highlight → click one → a PDA/economics pair card (label only, never a
  raw score; no counterparty contact — firewall).

`MapPane` props: `context` (page id → home/opponent via the registry), `cargos`,
`vessels`, `focusedCargo`, `focusedVessel`, `compact`, `portFilter`,
`onSelectCargo`, `onSelectVessel`.

### Markers & interaction (keep as-is)
- **Cargo markers are zoom-dependent**: dot (z≤6) → pill with name (z7–8) →
  thumbnail with commodity icon (z≥9). Colour = scope/laycan urgency
  (green/amber/red).
- **Vessel markers** = course-rotated triangles, size by DWT class, colour by
  status/urgency.
- **Clustering** via markercluster; custom cluster bubble.
- **Custom popup** on click (cargo/vessel) with View card / Voy OPEX / Match
  actions; route polyline drawn on focused cargo; `flyTo` on focused vessel.

---

## 1. Fullscreen option (implement)

The right-bar has a **maximize/minimize** control that toggles `fullscreen` state
on `MapPane`, which adds `.is-fullscreen` (the `.asb-map` expands to fill the
viewport) and calls Leaflet `invalidateSize()` after the layout change.

Port this as a real fullscreen toggle:
- Button in the map’s right-bar (Tabler `ti-maximize` / `ti-minimize`, tooltip
  “Fullscreen” / “Exit fullscreen”).
- Expand the map container to the full viewport (CSS class or the Fullscreen API
  — your call; the prototype uses a CSS `.is-fullscreen` overlay, which is the
  safer cross-browser choice inside an app shell).
- **Must call `map.invalidateSize()`** after toggling (and after any panel
  open/close) or Leaflet tiles render at the wrong size — see the
  `invalidateSize` effect keyed on `[fullscreen, voyOpen, compact]`.
- Escape key should exit fullscreen (add this; the prototype doesn’t yet).

## 2. Filtration tabs (implement — the user will tweak later)

A **Filters** icon in the right-bar opens a context-aware **filter sub-panel**
(`.filter-panel`). It is **context-aware**:

- A **Cargo positions** section shows when the cargo layer is on; an **Open
  tonnage** section shows when the vessel layer is on — so the dashboard (`both`)
  exposes the full set.
- Each section has: a **layer on/off switch** (hide the whole layer) and a row of
  **type chips** built from the live data (`cargo.type` set / `vessel.type` set);
  toggling a chip hides/shows that type. There’s a **Reset filters** action.
- Filters drive **real marker visibility** (the marker-build effect filters on
  `cargoSel` / `vesselSel` and the layer switches), not just styling.

State to port: `filtersOpen`, `showCargoLayer`, `showVesselLayer`, `cargoSel`,
`vesselSel`, plus `cargoTypeList` / `vesselClassList` derived from the data.

> **Note for the build:** keep the filter sections **data-driven and modular** —
> the user intends to **tweak the filter taxonomy later** (add facets like
> zone, laycan window, DWT class, geared/grain-cert, scope/urgency). So model a
> filter as `{ id, label, group: 'cargo'|'vessel', predicate(item) }` and render
> the chips from that list, rather than hard-coding the current “by type” chips.
> The current type chips are the v1; make adding a new facet a one-line addition.

## 3. Base theme + registry (keep)

- `useMapBase()` is a persisted (localStorage) + cross-instance-synced light/dark
  state; `MapBaseToggle` is the shared control (icon mode in the right bar). Both
  the market map and the fleet map must read the **same** state so they always
  match.
- Adding a page to the map = give `<MapPane context="…">` and add that key to
  `ASB_MAP_LAYERS.contexts` with its `home` side. Don’t hand-roll per-page layer
  objects.

## 4. Voy OPEX panel (keep, tier-gated)

The right-bar also opens a **Voy OPEX Estimator** slide-over with cost-group
include pills (Voyage economics / PDAs / Suez) and module tabs (Port DAs / Bunker
/ Load-Disch / Suez Canal) with live totals. It is **tier-gated** (locked for
T1/T2). Port the gating against the real subscription tier.

---

## Acceptance criteria
1. One `MapPane`, driven by the central layer registry; base tier always on.
2. **Fullscreen** toggle works, calls `invalidateSize()`, exits on Esc.
3. **Filter panel** is context-aware, data-driven, and actually filters markers;
   the facet list is modular so new filters are easy to add later.
4. Cargo zoom-states, vessel triangles, clustering, popups, route/flyTo, and the
   dashboard click-to-pair all behave as in the prototype.
5. Light/dark base is shared + persisted; Voy OPEX is tier-gated.

(Design is final — do not restyle. This is a behaviour/port task.)
