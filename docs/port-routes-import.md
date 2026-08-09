# Port routes — ECDIS import report (9 Aug 2026)

The ArabShipBroker MASTER Port Routes package (master workbook + 422 BVS8
voyage-plan exports) is now in the database and wired into the platform.

## What was imported

| | |
|---|---|
| Routes (unordered port pairs) | **438** |
| — with full waypoint geometry | 436 |
| — distance-only (no geometry yet) | 2 |
| Waypoints | 26,703 |
| Distinct ports connected | 220 |
| Distance-verified (geometry within 5% of the stated NM) | 433 |

Tables: `port_routes`, `port_route_waypoints`, `port_route_alias` (world-
readable reference data; service-role writes). Lookup: `get_port_route(pol,
pod)` — symmetric, alias-aware, returns `{"found": false}` for unknown pairs
so **no consumer can ever crash on a missing route**. Re-import any time with
`node scripts/import-port-routes.mjs` (idempotent; `--dry-run` first).

## Coverage of the real market

Measured against every cargo listing in the database today:

- **95% of cargo listings** (948 of 1,000) travel a lane with a measured route.
- **87% of distinct lanes** (347 of 397). The rest keep the existing estimator,
  labelled "est." — nothing breaks, they just aren't measured yet.

## What now uses the measured routes

1. **Voyage Cost Estimator** — laden and ballast legs auto-fill with the
   measured NM (leg note: *"Measured ECDIS route."*). Pairs without data fall
   back to the previous table/defaults exactly as before.
2. **Market map** — the focused cargo's route line upgrades to the real sailed
   track (solid, "ECDIS" tag) when the pair is measured; otherwise the dashed
   corridor estimate stays.

## Data fixes made during import (all hand-verified)

- Endpoint codes exported before the July port dedupe were remapped through
  41 documented aliases (SAJAZ/SAJIZ→SAGIZ, GRATH→GRPIR, ALDUR→ALDRZ, …) plus
  two same-port variants (RUNOI↔RUNVS Novorossiysk, UAREN↔UARNI Reni).
- `GRRET- to TPNG.csv` → Rethymno→**Porto Nogaro (ITPNG)** (endpoint
  coordinates verified on chart); `LYBGN toTRISK.csv` → Benghazi→Iskenderun
  (missing space); `TRMRM to UAODS.csv` is a second BVS8 export flavour
  (Dep/Way/Arr passage report) — parsed with its own reader.
- **Abu Qir→Gijón**: the workbook said 184.2 NM — impossible (Egypt→north
  Spain); the measured geometry's 2,596.6 NM was used instead.

## For review (2 unverified distances)

The workbook figure and the geometry disagree by more than 5% — both imported,
workbook figure kept, flagged `verified = false`:

- **Salerno → Mersin**: sheet 1,139 NM vs geometry 946.5 NM (16.9%)
- **Kdz Eregli → Chornomorsk**: sheet 320 NM vs geometry 411.9 NM (28.7%)

Worth a look at the original voyage plans when convenient.

## Growing the coverage

Drop new BVS8 exports into `ArabShipBroker MASTER Port Routes/` (any of the
naming styles) and re-run the importer — new pairs are added, existing ones
refreshed. The two distance-only pairs and the ~50 unmeasured lanes are the
natural next exports.
