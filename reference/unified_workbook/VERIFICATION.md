# Unified Cargo-Vessel Map — verification & reconciliation

**Source:** `ArabShipBroker_UNIFIED_Cargo_Vessel_Map.xlsx` (committed in this folder;
machine-readable per-sheet copies under `sheets/`). Declared by the workbook itself
as *"the single source for the website."* This file records what was verified against
it, what was reconciled, and what remains.

## 1. Inventory (12 sheets)

| Sheet | Rows | Role |
|---|---|---|
| 01_CARGO | 731 | Cargo listings, classification pre-resolved (regime/code/flag) |
| 02_VESSELS | 88 | Vessels, 55 fields incl. owner/comm-mgr/ISM company roles + contact PII |
| 03_COMPANIES | 80 | Owner / commercial-mgr / ISM-mgr firms (company IMO, fleet, address) |
| 04_PORTS | 276 | LOCODE, trade name, country, zone, type |
| 05_CLASS_MARKET_NAME | 85 | Resolver dictionary (market_name → regime/code) |
| 06_CLASS_GRAIN | 13 | Grain Code commodities |
| 07_CLASS_IMSBC | 258 | IMSBC BCSN + group (A/B/C) |
| 08_CLASS_CSS | 12 | CSS break-bulk categories + market aliases |
| 09_VESSEL_FIELD_SPEC | 55 | Per-field meaning / logic / type rule / criticality |
| 10_ENUMS | — | Canonical dropdown values |
| 11_VALIDATION | 90 | Field checks → DB table + status (EXISTS/PROPOSED/CORRECTION) |

## 2. Classification reconciliation — PASS (dictionaries) + 33 added

The workbook's classification dictionaries are **substantively identical** to the
engine already seeded (migrations `…000700`–`000704`):

| Dictionary | Workbook | Seed | Result |
|---|---|---|---|
| market_name map | 85 | 85 | identical |
| grain_list | 13 | 13 | identical (letter-case only) |
| imsbc_codes | 258 | 258 | identical (27 differ in letter-case only) |
| css_categories | 12 | 12 | identical |

The resolver matches `market_name ILIKE` (case-insensitive), so the casing diffs are
cosmetic — **no correction needed**.

**The 92 `UNMAPPED` cargoes** (`ASB_RESOLVE_FLAG = "UNMAPPED — add to master map"`)
reduce to **33 distinct commodities** whose market names were simply absent from
`commodity_map`. They are now added by migration
`20260601000705_cargo_classification_unmapped_seed.sql`, resolved data-drivenly by the
workbook's own rule (grain→GRAIN, break-bulk→CSS, else IMSBC), with codes from the
authoritative dictionaries:

- **Steel** → CSS-07 (`Steel Plates/Sheets/Slabs/Debars, DBIC`), **coils** → CSS-06
  (`Hot Rolled Coils`), **heavy/project** → CSS-05 (`Project Cargo, Granite Blocks`),
  **wheel** → CSS-04 (`Shredded Tyres`), **unit-load/bagged** → CSS-12
  (`MDF Boards, Chipboards, General Cargo, Mixed BB, …`).
- **Dry-bulk minerals with an exact BCSN** → IMSBC (`Alumina, Clay`).
- **Dual-form** (shipped both bulk and break-bulk: `Gypsum, Soda Ash, Anthracite,
  Boron Products, Feldspar, Sulphur, Phosphate, Fly Ash, Coal Tar Pitch, Glass,
  Marble Chips, Ammonium Nitrate`) → default by observed type, `plausible_regimes
  = {CSS, IMSBC}` so the guard accepts either and the resolver picks the live regime
  from `is_bulk` at call time.

After this migration, **all 731 reference cargoes resolve to a regime + code.**

> Note `Ammonium Nitrate` is dangerous-goods; it carries plausible {CSS,IMSBC} here,
> but `is_dg_cargo` (the DG hard-block in matching) is a separate per-listing flag and
> must be set on the cargo record — not inferred from the commodity map.

## 3. Schema reconciliation — the validation matrix (open to-do)

Status tally: **47 EXISTS · 20 PROPOSED · 7 CORRECTION**. The non-EXISTS rows are the
delta between the live schema and this canonical model. These are **not yet built** —
they're the agreed next tranche of append-only schema work.

### 7 CORRECTIONs (change existing behaviour)
- `cargo_listings` — Load rate (MT/day): **max revision** (range cap)
- `cargo_listings` — Discharge rate (MT/day): **max revision** (range cap)
- `cargo_listings` — Stowage factor: **unit selection + range correction** (unit toggle)
- `vessels` — **rename** `Grain CBM` → *Cargo Intake Capacity* + unit selection + priority escalation
- `cargo_listings` — Commodity: **rename** IMSBC/PSN → **IMSBC/BCSN** (auto-fill)
- `cargo_listings` — Quantity tolerance (MOLOO %): **option-holder distinction** (enum + range)
- `vessel_availability` — Open date **90-day cap**: escalated from PROPOSED → **new field to add**

### 20 PROPOSEDs (new validations/fields)
- **profiles:** dual-role email flag
- **cargo_listings:** IMSBC/BCSN auto-fill · MOLOO % · disport status · laycan 45-day cap ·
  packaging/form dependency · bag weight (kg) · stowage soft check · WOG amber banner
- **vessels:** DWCC cross-field · IMO check-digit · IMO uniqueness · sanctions check ·
  disponent-owner TC upload · max draft range
- **vessel_availability:** aux consumption range · crane SWL dependency · #cranes dependency ·
  BROB range · open-date 90-day cap

## 4. Blockers (cannot be satisfied from this file alone)

1. ~~**Map coordinates absent.**~~ **RESOLVED** (migration `…000710`). Root cause was
   a bug, not just missing data: the prior backfill `…000350` keyed coordinates on
   *spaced* locodes (`'UA ODS'`) while the ports table uses 5-char no-space
   (`UAODS`), so its join matched zero rows and the map had nothing to plot.
   `…000710` backfills display-grade city/terminal centroids for **all 275**
   ports-sheet LOCODEs, keyed correctly (matched on a normalised locode so it's
   format-agnostic). Coordinates are centroid-grade, not berth-precise.
2. **Org / sub-user model not seedable here.** The 80 companies are shipowner/manager
   firms with no desk-email/phone and no people/emails; contact PII is per-vessel. The
   `organizations + organization_members + desk contact` design (locked separately) has
   no membership or desk-contact data in this workbook — it awaits a people/emails list.

## 5. Done in this pass
- Persisted the workbook + per-sheet JSON into the repo (canonical source no longer
  lives only in an ephemeral upload).
- Verified the classification dictionaries match the seeded engine (no drift).
- Added migration `…000705` resolving all 92 unmapped cargoes (33 commodities).
- Added migration `…000710` fixing the map: corrected port-coordinate backfill for
  all 275 LOCODEs (the prior `…000350` matched zero rows due to a locode-format bug).
- Catalogued the 7 CORRECTION + 20 PROPOSED schema deltas for the next tranche.

**Not applied to production** — migrations are staged in the repo; applying to the
prod Supabase + the schema-delta tranche in §3 are the next steps.
