# Claude Code — Arab ShipBroker map: sea-following route lines (POL → POD)

You are porting an **approved prototype change** into the **real Arab ShipBroker
codebase** (Next.js + Supabase). This bundle contains the prototype files
(plain-React/Babel running inside `Portal.html`). Treat them as the **source of
truth for behaviour and the route algorithm**, and translate them into the
production app's real components / hooks / data layer. Do **not** copy the
Babel / `window.*` global pattern into production.

## The problem this fixes

When a user selects a **cargo card**, the map draws the voyage line from load
port (POL) to discharge port (POD). The old line was a **straight great-circle
chord** — which sails over land (Sinai, Anatolia, the Horn of Africa) and is not
a real maritime route. It must instead be a **smooth, land-avoiding sea track**
that bends through the real chokepoints (Bosphorus, Dardanelles, Suez Canal,
Bab-el-Mandeb, Strait of Hormuz) — **curved, never zig-zagging, never a hairpin.**

When the selected port pair exists in the **stored port-to-port table** (the same
table the distance matrix was computed from), the line must use that **exact
stored geometry and distance**. For any other pair it falls back to a generated
land-avoiding corridor curve, clearly labelled as an estimate.

This must hold for **every cargo card on every page that renders a map** (the app
has one shared map component, so this is a single integration point).

---

## Bundle

| File | What it is |
|---|---|
| `asb/route-waypoints.js` | **The engine.** Pure, framework-free. Exposes one function. This is the thing to port. |
| `asb/map.jsx` | The prototype map. Shows the **integration point** — the "focused cargo → draw route" effect (search `ASB_routeGeometry`, ~line 543). |
| `asb/map.css` | Route line + distance-chip styling (search `route-tag`). |
| `asb/data.js` | Demo cargo shape — shows the `route` object the engine consumes (`polCode/polName/polZone`, `podCode/podName/podZone`). |
| `reference/ArabShipBroker_MASTER_Port_Routes.xlsx` | **The source data.** The stored ECDIS voyage plans + waypoints the engine's exact tier is built from. Sheets: `01_ROUTES` (one row per pair, with `total_nm`), `02_WAYPOINTS` (the lat/lon geometry), `03_PORTS_USED`. |

**Runtime dep:** Leaflet 1.9 (already used by the map).

---

## The model (read first)

`asb/route-waypoints.js` exposes exactly one entry point:

```js
window.ASB_routeGeometry({ polCode, podCode, polLL, podLL, polZone, podZone })
//  → { pts: [[lat,lon], …], nm: Number|null, exact: Boolean, source: 'ecdis'|'corridor'|'arc' }
```

- `polCode` / `podCode` — UN/LOCODEs (e.g. `EGALY`, `JOAQJ`). Used to look up a
  stored route.
- `polLL` / `podLL` — the `[lat, lon]` the map already places the port markers
  at. The returned line is **snapped to these** so it connects to the dots
  exactly (no floating endpoints).
- `polZone` / `podZone` — sea zone codes (`B.SEA`, `E.MED`, `R.SEA`, `AG`,
  `A.SEA`, `E.AFR`, `ADRIATIC`, `C.MED`, `W.MED`). Used to route the corridor
  fallback through the right chokepoints.

It resolves in **three tiers, in priority order**:

1. **`ecdis` (exact).** If `POL|POD` (either direction) is in the stored
   `ECDIS` table, return that exact geometry + its stored `nm`. `exact: true`.
   *This is the "reference it to the database" requirement.*
2. **`corridor` (estimate).** Otherwise BFS a path across an adjacency graph of
   sea zones, stitch the chokepoint waypoint-chains for each zone transition,
   then **de-kink and smooth** (see below). `exact: false`.
3. **`arc` (estimate).** Same-zone or unknown pair → a gently bowed quadratic
   arc (never a ruler-straight line). `exact: false`.

### Two correctness guarantees (the heart of the fix — do not drop these)

The prototype's first attempt looked smooth on paper but produced **hairpins** on
real routes (e.g. Istanbul → Alexandria sailed *north* into the Black Sea, then
doubled back, because Istanbul sits mid-Bosphorus, *past* the chain's northern
entry waypoint). Two passes fix it; keep both:

- **`dekink(pts, 100)`** — a real voyage never reverses ~>100° at a single
  vertex. This pass iteratively removes the worst offending interior control
  point until the track is monotone toward the destination. Endpoints (the
  actual ports) are never removed. This is what kills the zig-zag.
- **`smooth(pts, perSeg)` = centripetal Catmull-Rom (α = 0.5).** The uniform
  Catmull-Rom variant *overshoots / loops* when control-point spacing is uneven
  (long open-water hops between chokepoints), creating cusps. The centripetal
  parameterisation does not. Use it for **both** the corridor and the exact
  ECDIS tier.

Verification we used: for every demo pair, the **max turn angle** of the final
polyline must stay low (we land ≤ 28°; anything > ~100° is a hairpin bug).

---

## Integration point (one place)

In the prototype, the whole feature is wired in `map.jsx`'s **"Focused cargo →
draw route + fit bounds"** effect. The shape to reproduce in the real
`MapPane`:

```js
// when a cargo is focused/selected:
const pol = portLL(focusedCargo.route.polName);   // [lat, lon] of the POL marker
const pod = portLL(focusedCargo.route.podName);
if (!pol || !pod) return;

const geo = ASB_routeGeometry({
  polCode: focusedCargo.route.polCode,
  podCode: focusedCargo.route.podCode,
  polLL: pol, podLL: pod,
  polZone: focusedCargo.route.polZone,
  podZone: focusedCargo.route.podZone,
}) || { pts: [pol, pod], nm: null, exact: false, source: "arc" };

const line = geo.pts?.length >= 2 ? geo.pts : [pol, pod];

// 1) soft halo "casing" under the track for legibility on any basemap
L.polyline(line, { color: base==="dark" ? "#0B1B30" : "#FFFFFF",
                   weight: 5.5, opacity: 0.55, lineJoin:"round", lineCap:"round",
                   interactive:false });
// 2) the sailed track — SOLID when exact (ECDIS), DASHED when estimated
L.polyline(line, { color: "#185FA5", weight: 2.2, opacity: 0.95,
                   lineJoin:"round", lineCap:"round",
                   dashArray: geo.exact ? null : "7 6", interactive:false });
// 3) POL (green) / POD (red) end dots
// 4) distance chip at the track midpoint: `${geo.nm} NM` + source tag
//    ("ECDIS" when geo.exact, else "est.") — styles in map.css `.route-tag`
// 5) fitBounds to the WHOLE line (curved corridors swing wide of the chord)
```

The **solid-vs-dashed** line and the **"ECDIS" vs "est."** chip are the user-
visible signal of whether the line came from the stored table or was generated.
Keep that distinction.

---

## Porting tasks

1. **Port `asb/route-waypoints.js` as a pure module** — e.g.
   `lib/routeGeometry.ts` exporting `routeGeometry(opts)`. It has **no
   dependencies** (just math) — a near-verbatim port is fine. Keep `dekink` and
   the centripetal `smooth` exactly as-is.

2. **Source the stored routes from the database, not a hardcoded object.** In the
   prototype, the `ECDIS` table and the corridor `EDGES` are inlined constants
   (built from the attached xlsx). In production:
   - **Stored routes (tier 1):** read from your port-to-port routes table — the
     one the distance matrix already comes from. Shape per pair: `total_nm` +
     an ordered `[lat, lon]` waypoint list, keyed by `POL|POD` LOCODE, treated
     symmetrically (reverse = same line). `reference/…MASTER_Port_Routes.xlsx`
     `02_WAYPOINTS` shows the exact geometry; `01_ROUTES.total_nm` is the stored
     distance. Seed/migrate these 20 plans, then **grow the table** over time
     (more stored pairs ⇒ more lines draw exact instead of estimated).
   - **Corridor `EDGES` (tier 2):** these chokepoint chains can stay as a small
     static config (`B.SEA|E.MED` = Bosphorus, `E.MED|R.SEA` = Suez,
     `R.SEA|A.SEA` = Bab-el-Mandeb, `A.SEA|AG` = Hormuz, …). They are reference
     geography, not user data. Keep the BFS zone-adjacency logic.

3. **Wire it into the real `MapPane`** at the single focused-cargo effect
   (above). Remove any remaining straight `L.polyline([pol, pod])` for routes.

4. **Confirm it covers every map.** Because there is one shared map component,
   one integration point covers the dashboard, cargo market, my-cargo, etc. Just
   verify each surface that can focus a cargo draws the curved line.

---

## Acceptance criteria

- [ ] Clicking any cargo card draws a **curved, sea-following** line POL → POD —
      never a straight chord, never a hairpin/zig-zag (max turn stays well under
      ~100°).
- [ ] A pair **in** the stored table draws the **exact stored geometry**, a
      **solid** line, and the stored distance with an **"ECDIS"** tag.
- [ ] A pair **not** in the table draws a smooth corridor curve through the
      correct chokepoints, a **dashed** line, distance with an **"est."** tag.
- [ ] The line endpoints snap exactly to the POL/POD markers.
- [ ] `fitBounds` frames the whole curved track (not just the two endpoints).
- [ ] Works on every page that renders the map; respects the light/dark basemap
      (halo colour swaps).

## Notes

- The corridor estimates are deliberately labelled **"est."** — they are
  geometry-plausible, not surveyed. The way to make any given lane *exact* is to
  add its row to the stored routes table, not to tune the corridor.
- None of the current **demo** cargo pairs happen to exist in the 20-row stored
  table, so in the prototype they all render as corridor estimates. In
  production, whichever pairs you've stored will render exact automatically — no
  code change.
- Keep route polylines **non-interactive** (`interactive: false`) so they don't
  swallow marker/popup clicks.
