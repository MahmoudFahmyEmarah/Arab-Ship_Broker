# Map redesign — implementation status

Handoff: `CLAUDE_CODE_MAP_PROMPT.md` (prototype in `prototype/`). Behaviour/port
task — design is final, do not restyle. Built on branch `claude/map-redesign`.

The production app already has most of the prototype's map behaviour in
`components/portal/MarketMap.tsx` (base tier Carto + OpenSeaMap, light/dark toggle,
cargo zoom-states dot→pill→thumb, vessel triangles, markercluster, custom popups,
route polyline on focused cargo, flyTo on focused vessel) and `FleetMap.tsx`. So
this is a gap-fill toward the prototype, not a rewrite.

| # | Criterion | State | Notes |
|---|-----------|-------|-------|
| 1 | One MapPane driven by a central layer registry; base tier always on | 🟡 partial | Base tier + home/opponent toggles already exist per map. A single `ASB_MAP_LAYERS`-style registry consolidating MarketMap + FleetMap is **not** done — they remain two components. |
| 2 | **Fullscreen** toggle, `invalidateSize()`, exits on Esc | ✅ done (MarketMap) | Right-bar maximize/minimize button → `.is-fullscreen` (position:fixed/inset:0), 240ms `invalidateSize`, Esc exits. TODO: mirror on FleetMap. |
| 3 | Context-aware, **data-driven filter panel** that actually filters markers; modular facets | ⬜ pending | Add a Filters right-bar button → `.filter-panel` with cargo/vessel sections, layer on/off + type chips derived from data, Reset. Model facets as `{id,label,group,predicate}` so new facets (zone, laycan, DWT, geared/grain, urgency) are one-line adds. |
| 4 | Cargo zoom-states, vessel triangles, clustering, popups, route/flyTo, dashboard click-to-pair | 🟡 mostly | All present except **dashboard click-to-pair** (click cargo → eligible vessels highlight → click one → label-only PDA/economics pair card, firewall-safe). |
| 5 | Light/dark base shared + persisted; Voy OPEX tier-gated | 🟡 partial | Light/dark already persisted (localStorage) + shared via `useMapBase`. **Voy OPEX** slide-over (cost-group pills + Port DA/Bunker/Load-Disch/Suez tabs, tier-gated T1/T2) is **not** built. |

## Done this session
- Fullscreen toggle on MarketMap (criterion 2). Persisted the map handoff here.

## Next (priority)
1. FleetMap fullscreen parity.
2. Data-driven filter panel (3) — modular facet model.
3. Voy OPEX tier-gated slide-over (5).
4. Dashboard click-to-pair (4).
5. Optional: consolidate to one registry-driven MapPane (1).
