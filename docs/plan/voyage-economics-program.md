# Voyage Economics Program — architecture, split and priorities

Owner: Capt. Mohamed Dawoud. Architect / coordinator: Opus (the session that owns `opus-to-codex.md`; it now runs on Claude Fable 5.1, the mailbox identity stays "Opus").
Date: 3 Oct 2026. Base: `origin/dev` = `677613e` (equals production `main` tree). Status: **ACTIVE — Phase 0 (scaffold) in progress.**

This document is the single source of truth for the three streams below. Every engineer reads it before starting and re-reads it after any `PLAN UPDATED` line in `opus-to-codex.md`. Changes to a contract in §4 are made only by the architect, announced in the mailbox with a new revision number at the top of this file.

Revision: **r1** (3 Oct 2026).

---

## 1. What the owner asked for (and the business rules we must honour)

Two member-facing features and four admin/backend features, all from the owner's brief of 3 Oct 2026 plus the Claude Design prototype (`tmp/Arab ShipBroker Portal - Standalone (7).html`, decoded sources in the architect's scratchpad; the relevant screens are described in §3 per stream).

### 1.1 Suez Canal Transit Cost Calculator (member page, exists as a hard-coded proforma at `/dashboard/suez-toll`)
Three cost layers, every item tariff-driven with effective dates, never constants in code:
1. **Transit tolls** — SDR per SCNT, tiered by SCNT band, by SCA vessel category and laden/ballast. SDR→USD is a dated rate, not a constant. (Official SCA tolls table — **owner to supply the current circular**; the schema must accept it as data.)
2. **Fixed accompanying charges** (every transit): pilotage, mooring (Circular 1/2026: USD 3,800 for GT ≥ 2,500, USD 2,350 below, from 15 May 2026; no SCA electrician boards), Port Said Port Authority, Red Sea Ports Authority, lights dues, quarantine, **mandatory waste fee**, security/immigration, service launch, bank charges, agency fee.
3. **Conditional charges** — shown as **risk flags** with their potential value; added to the total only when the vessel/voyage data satisfies the condition:
   - imposed tug 22,000 SDR (e.g. vessel > 10,000 GT without cranes able to lift two mooring boats at SWL 3 t);
   - late arrival for the convoy: +5% / +10% / +12% of tolls, capped at SDR 12,500 / 25,000 / 30,000;
   - no compliant searchlight: USD 500 per transit (Circular 1/2026);
   - vessel enlisted but not ready: USD 5,000;
   - heavy lift unit ≥ 250 t: +50% on tolls; floating unit SCGT ≥ 300: 125%;
   - navy / government-chartered or ≥ 50% military cargo: +25%;
   - deck-cargo protrusion beyond limits: +2% per foot;
   - age over 20–25 years: inspection, cost undetermined (flag only);
   - pilot/accommodation ladder non-compliant: USD 5,000; relieving pilot at Bitter/Timsah lakes USD 1,000 each;
   - **first transit**: vessel is measured, SCNT estimate is uncertain (flag only).
4. **Waste (Antipollution Egypt, Periodical 2/2026, from 15 Apr 2026)** — mandatory by SCNT: ≤ 10,000 → USD 235 (3 m³ included); > 10,000–40,000 → 825 (4 m³); > 40,000–70,000 → 1,120 (4 m³); > 70,000 → 1,410 (5 m³). Extra non-hazardous USD 99/m³; hazardous USD 1,000/m³; bags USD 10 per m³; barge: first hour free, then USD 200/h.

Inputs — vessel: SCNT, SCGT (from the Suez special tonnage certificate; last transit date), GT (mooring band), SCA vessel category, build year, cranes (count, SWL), compliant searchlight (y/n), first transit (y/n). Voyage: direction NB/SB, laden/ballast, cargo type, heavy unit ≥ 250 t (y/n), military/dangerous cargo (y/n), expected transit date (selects the tariff version and SDR rate), waste volumes (normal / hazardous m³, bags, barge hours).

Outputs: the three layers itemised, risk flags with potential amounts, waste block, grand total in USD with the SDR rate and tariff version stamped; export; "feeds the Voyage Estimator as a voyage cost plus transit + anchorage days".

Golden fixture: **RUBATO**, laden bulk carrier, SB, April 2026: tolls USD 189,854 (≈94%), other USD 11,221 (≈6%), total USD 201,075. (Owner to attach the RUBATO estimate; until then the fixture is the published numbers.)

### 1.2 Voyage Cost Estimator (member page, exists admin-only and hard-coded at `/dashboard/voyage-estimator`)
- Vessel profile: speed laden / ballast (kn); daily consumption per state and per fuel family (heavy residual vs light distillate): `sea_laden, sea_ballast, port_working, port_idle, anchorage, eca_sea`; `has_scrubber`; vessel class A/B/C.
- Distances per leg from `port_routes` (`get_port_route`), split into ECA and non-ECA miles. The Mediterranean is an ECA since 1 May 2025: inside it the ship burns 0.10% fuel (LSMGO/ULSFO), not VLSFO.
- Days: sea days = NM ÷ (speed × 24) × (1 + sea margin). Sea margin default + per-lane and per-season overrides (admin). Port days from the deal (qty ÷ load/disch rate + allowances), split working/idle. Anchorage days entered by the broker. Suez transit + anchorage days when the route crosses the canal.
- Fuel: quantity per product = Σ(rate × days); cost = quantity × price from the **Fuel Bar** at the bunkering port (index), itemised VLSFO / MGO / LSMGO (and HSFO when scrubber-fitted).
- Daily vessel cost: base class C = crew USD 1,450/day + maintenance USD 800/day; multipliers C 1.0, B 1.5, A 2.2 — all admin-editable settings, never constants.
- Outputs: total days (sea / port / anchorage / canal), fuel quantity and cost by product, daily cost × days, Suez transit cost, port DAs (from the PDA module when a published tariff exists, else manual), total expected voyage cost; plus freight, commission, net, TCE (already in the legacy engine). Save estimate.

### 1.3 Fuel Bar / Bunker ticker + supplier entry (member strip + supplier portal + admin)
- Bunker suppliers (first-hand physical suppliers, not brokers) get an account/link to enter and refresh their price tables (every ~10–14 days, or on a big move). Prices are execution prices in good faith.
- Ticker strip at the top of the dashboard / markets / estimators: sponsor name (their exposure), port(s), per-product price with direction arrows, freshness: ≤ 7 d current, 8–14 d stale (flat arrow, "·Nd"), 15–21 d expired ("Outdated"), > 21 d hidden.
- The platform computes the **index** (best / median / count per product per port) that feeds the Voyage Estimator. Every price has a timestamp and validity; **never show zero**; expired quotes drop out of the index immediately; "No current offer" when nothing is live.
- Product key = family + sulphur class + ISO 8217 grade; market label (VLSFO, HSFO 380, LSMGO, MGO, ULSFO, MDO) is display only. Per port three core slots (HSFO 380, VLSFO, LSMGO) + ULSFO at ECA ports. Spreads HSFO↔VLSFO and VLSFO↔LSMGO as indicators.
- Compliance rule for the estimator: no scrubber → VLS/ULS only; inside an ECA or at an EU berth > 2 h → ULS only; scrubber → all classes subject to the port's open-loop ban flag.
- Normalised comparison = price + barge fee + mandatory charges; supplier identity shown on the ticker (that is their reward), hidden in multi-supplier comparisons until negotiation (contact firewall).
- Admin: sponsor list (enable/disable, ports, access management), current prices with manual overrides (until the supplier republishes), update history, freshness alerts.
- Names to onboard first: O Bunker, Bahri Bunker, التعاون للبترول (Mr Sameh).

### 1.4 Admin pages
- **Voyage estimator data**: Suez tariff tables + SDR rate, constants & assumptions (default speeds, sea margin, port time defaults, opex base, class multipliers, Suez days), fuel feed status (link to Bunker), ECA zones.
- **Matching rules**: the matcher's tunable parameters stored as data (DWCC/DWT tolerance, part-cargo tolerance, laycan buffer before/after, stowage threshold, vessel age soft limit, minimum score, zone weight…) with safe ranges, defaults, reset, audit.
- **Intelligence rules**: data-driven card flags (entity, field, condition, threshold, severity, tag, message, active) replacing hard-coded tooltip rules; safety questions stay on their own page; "future frameworks" as empty rule groups.

---

## 2. What exists today (facts from the 3 Oct survey of `677613e`)

- `/dashboard/suez-toll`: real page, admin-only (`ComingSoon` for others), engine `lib/portal/econ.ts` with constants (SDR 1.38, 8.687/6.515 SDR per SCNRT, 12 fixed USD lines = 11,221). No table, no RPC. `vessels.scnrt` with DWT×0.45 fallback.
- `/dashboard/voyage-estimator`: admin-only; `calcVoyage` in `econ.ts` (speeds 12.5/13 hard-coded, VLSFO sea only, LSMGO port only, Suez = 1 day/100 NM, KAP-SAR PDA for every port, POD PDA 42,000). Distances via `sdk/app/routes.ts` → `get_port_route` (returns waypoints with cumulative NM and `chokepoints`). `voyage_estimates` table exists, nothing writes it. `vessel_availability` has `service_speed_kn`, `vlsfo_*`, `lsmgo_*`, `me_*`, `scrubber_fitted`, `eca_compliant`; members fill `me_*`, the estimator reads `vlsfo_*` (write-path gap).
- Fuel: `public.fuel_prices` (5 rows in production; RLS admin write / all read; no admin UI). `components/portal/BunkerTicker.tsx` is a DEMO placeholder. **`/admin/bunker` and `/api/bunker/ingest` reference `bunker_*` tables that do not exist in production** (archived pre-baseline migration) — both are dead in production.
- Vessel master `public.vessels`: `gross_tonnage`, `scnrt`, `build_year`, `is_geared`, `crane_count`, `crane_swl_mt`, `max_loa_m`, `beam_m`, `class_society`… No SCGT, no searchlight, no class A/B/C, no per-state consumption.
- Matching: `get_matches_for_cargo/availability` + `v_eligible_matches` + `fn_refresh_matches` (baseline + `supabase/baseline/30_matching_layer.sql`), gates and score literals; members reach matches only through `market_private` / `list_market_matches` (firewall 360000–362000). Client mirror `lib/portal/matching.ts`. Only freshness/active windows are settings-driven (`app_settings.platform_settings.marketplace`, `app_settings.market_visibility`).
- Intelligence: `fn_build_market_insights` (weekly editions) with hard-coded bands; admin nav "Intelligence rules" currently points at `/admin/safety-questions`.
- Settings store: `public.app_settings(key, value jsonb)` — read all, write admin (`fn_is_admin`); readers `lib/app-settings.ts`, writers `app/(admin)/admin/settings/actions.ts`, SQL readers in `market_private`.
- PDA module (Codex): `port_tariff_sets/versions/rules/bands` with `basis` vocabulary (`flat, per_call, per_day, per_gt, per_nt, per_scnrt, percentage, tiered_flat, tiered_rate, progressive, manual_quote…`), effective dates on versions, source refs on rules; pure engine `lib/pda/calculate.ts`; member RPCs `get_pda_calculation_context`, `list_pda_coverage`; service-role write RPCs with `p_actor`. Architecture doc: Suez is its **own domain**, not a port PDA.
- Admin conventions: `lib/admin/sections.ts` (ids, OWNER_ONLY, presets), `lib/admin/nav.ts`, `requireAdmin({section, edit})`, `getAdminSupabaseClient()` (cookie) for reads, `getSupabaseAdminClient()` (service role) for writes after the guard, `AdminPageHeader`, `components/admin/ui/*`, `.adm-*` CSS in `app/(admin)/admin.css`, design tokens `app/design-tokens.css` (never hard-code hexes).
- Grants: new functions are service_role/owner only (default privileges + event trigger `ensure_function_acl`); member reads need an explicit `grant execute … to authenticated`; new tables get RLS auto-enabled and must be revoked from members unless intended.
- Gates: `npm run prebuild` chain (check scripts under `scripts/*-check.ts`), Playwright configs per module, `scripts/db-rebuild.sh` (public-schema reset — isolated DBs only), DOWN files in `supabase/rollback/`, `scripts/release-check.sh`.

---

## 3. Streams and ownership

| Stream | Owner | Branch | Worktree | Migrations | Admin section ids | Member routes |
|---|---|---|---|---|---|---|
| **S — Suez calculator + Voyage estimator + Voyage data admin + vessel economics profile + ECA split** | Opus (architect) | `feature/suez-voyage` | `D:\ASB_Projects\Arab Shipborker\Arabshipbroker-voyage` | `20261003 2xxxxx` | `voyagedata` | `/dashboard/suez-toll`, `/dashboard/voyage-estimator`, `/admin/voyage-data` |
| **B — Bunker: fuel products, suppliers, quotes, index RPC, ticker, supplier portal, admin bunker** | **Opus B** (new Claude Opus 5.5 session) | `feature/bunker-fuel-bar` | `D:\ASB_Projects\Arab Shipborker\Arabshipbroker-bunker` | `20261003 1xxxxx` | `bunker` (exists) | `/dashboard/bunker-supplier`, `/admin/bunker` (rebuild), `BunkerTicker` |
| **R — Matching rules (data-driven matcher) + Intelligence rules (data-driven card flags) + their admin pages** | **Codex** | `feature/matching-intelligence-rules` | Codex's choice (under `tmp/` as before) | `20261003 3xxxxx` | `matching` (owner-only), `intelligence` | `/admin/matching-rules`, `/admin/intelligence-rules` |

All three branch from **`feature/econ-scaffold`** (dev `677613e` + the scaffold commit, §6). Codex composes the release at the end, as for the 30 Sep release; Opus cross-audits.

Why this split: S is one coupled engine family (the voyage engine consumes the Suez estimate and the ECA split) and the architect already owns `port_routes`; B is a self-contained new vertical with a crisp contract (§4.1) — ideal for a fresh session; R lives inside the matcher SQL and the market firewall that Codex wrote and owns.

### 3.1 Stream S — scope (Opus)
DB (`20261003200000+`):
- `suez_tariff_versions(id, version_no, status draft|published|superseded, effective_from, effective_to, source_ref, source_url, notes, published_at, published_by)`; one published version per date.
- `suez_tariff_items(id, version_id, code, label_en, label_ar, layer toll|fixed|conditional|waste, basis flat|pct_of_toll|tier_by_scnt|per_unit|per_gt_threshold|toll_tiered_scnt, currency USD|SDR, params jsonb, direction_scope any|SB|NB, cargo_status_scope any|laden|ballast, condition_key, payer_party, cap_sdr, sort_order, is_active)`.
- `suez_toll_tiers(id, version_id, vessel_category, cargo_status, tier_order, scnt_from, scnt_to, sdr_per_scnt)`.
- `sdr_rates(id, rate_usd, as_of, source, created_by, created_at)`.
- `eca_zones(code, name, polygon jsonb [[lat,lon]…], effective_from, sulphur_limit_pct)`; `fn_route_eca_split(p_pol, p_pod) → jsonb {found, total_nm, eca_nm, by_zone[]}` from `port_route_waypoints`.
- `vessel_economics_profiles(vessel_id pk, scgt, scnt, gt, suez_category, last_suez_transit, first_transit, searchlight_compliant, mooring_cranes_ok, speed_laden_kn, speed_ballast_kn, consumption jsonb {sea_laden:{residual,distillate}, sea_ballast, port_working, port_idle, anchorage, eca_sea}, has_scrubber, vessel_class A|B|C, source member|admin|sync, updated_by, updated_at)`; RPCs `get_vessel_economics_profile(uuid)` (vessel managers + admins), `upsert_vessel_economics_profile(jsonb)`.
- `app_settings` key **`voyage_settings`** (see §4.3) and admin RPC-free writes through the existing settings action pattern.
- Reads granted to `authenticated`: `get_suez_tariff_context(p_date)`, `fn_route_eca_split`, `get_vessel_economics_profile`. Writes: service role + `p_actor` (`admin_suez_*`, `save_voyage_estimate` into the existing `voyage_estimates`).
- DOWN file `supabase/rollback/20261003_suez_voyage_down.sql`.
Code: `lib/suez/{types,engine,schemas}.ts` (pure), `lib/voyage/{types,engine,schemas}.ts` (pure; imports the Suez engine and the Fuel index type from §4.1), `sdk/app/{suez,voyage}.ts`, pages above, admin `/admin/voyage-data` (tabs: Suez tariffs · Toll tiers · SDR rate · Constants & assumptions · ECA zones · Fuel feed status), `scripts/suez-check.ts` and `scripts/voyage-check.ts` with golden fixtures (RUBATO), Playwright `e2e/voyage-economics.spec.ts`. The legacy `lib/portal/econ.ts` Suez/voyage functions are retired in favour of the new engines; `VoyOpexPanel` and `lib/portal/matching.ts` callers are re-pointed.

### 3.2 Stream B — scope (Opus B)
DB (`20261003100000+`):
- `fuel_products(key pk, family residual|distillate, sulphur_class HS|VLS|ULS, iso_grade, market_label, co2_factor, core_slot boolean, sort_order, is_active)` seeded: `HSFO380 (RMG380, HS)`, `VLSFO (RMG/RME, VLS)`, `ULSFO (ULS)`, `LSMGO (DMA, ULS 0.10)`, `MGO05 (DMA, VLS)`, `MDO (DMB)`.
- `bunker_suppliers(id, name, url, ports text[] of LOCODEs, country, verified, status enabled|disabled, trust_score, notes, created_at…)`.
- `bunker_supplier_members(supplier_id, user_id, role editor|viewer, invited_by, created_at)` — a normal member account linked to a supplier; **no new `users.role`** (the 330000 privilege boundary stays untouched).
- `bunker_quotes(id, supplier_id, port_locode → ports, product_key → fuel_products, price numeric, currency 'USD', unit 'mt', delivery_mode barge|truck|pipe|ex_wharf, min_qty_mt, barge_fee_usd, mandatory_charges_usd, valid_from, valid_until, source supplier|admin_override|admin_input, submitted_by, submitted_at, superseded_at)`; latest live row per (supplier, port, product) wins; append-only history via `superseded_at`.
- `bunker_quote_events` (audit: who, when, old → new, reason) — drives the admin "Update history".
- RPCs: `get_bunker_ticker()` (authenticated; enabled suppliers; freshness state per sponsor; direction vs previous quote; hides > 21 d), **`get_fuel_price_index(...)` (§4.1)**, `supplier_upsert_quotes(p_quotes jsonb)` (authenticated; membership-checked; validates product keys/ports/validity; never accepts 0), `supplier_list_my_quotes()`, `admin_bunker_upsert_supplier`, `admin_bunker_set_member`, `admin_bunker_override_quote`, `admin_bunker_list_*` (service role + `p_actor`).
- Migrate `public.fuel_prices` rows into `bunker_quotes` as `admin_input` under a "Platform (manual)" supplier, then stop reading `fuel_prices` (keep the table; drop in a later release).
- DOWN file `supabase/rollback/20261003_bunker_down.sql`.
Code: `sdk/app/bunker.ts` (**the only module other streams import**), `lib/bunker/{types,freshness,index}.ts`, rebuilt `components/portal/BunkerTicker.tsx` (live data, same visual contract as the prototype: sponsor link ↗, port, `{product} ${value}/MT ▲▼–`, "·Nd" stale, "Outdated" expired, JOIN CTA, "Updated hh:mm UTC"), supplier portal `app/(dashboard)/dashboard/bunker-supplier/*` (grid by port × product, validity, history, "republish"), admin `app/(admin)/admin/bunker/*` rebuilt (sponsors, access, current prices + overrides, history, freshness alerts), delete or replace `app/api/bunker/ingest/route.ts` (if kept: token per supplier stored via Vault like Data Sync, not Basic auth), `lib/portal/data.ts#loadFuelPrices` → `sdk/app/bunker.ts#getFuelPriceIndex`, `scripts/bunker-check.ts` (freshness tiers, index maths, never-zero, hidden-after-21d, membership refusal), Playwright `e2e/bunker.spec.ts`.

### 3.3 Stream R — scope (Codex)
DB (`20261003300000+`):
- `app_settings` key **`matching_rules`** (§4.4) + `fn_matching_params() returns jsonb` (stable, reads the key with defaults) used by `get_matches_for_cargo`, `get_matches_for_availability`, `v_eligible_matches` (score weights, minimum label), `fn_refresh_matches*`, and `market_private` wrappers; `lib/portal/matching.ts` mirror reads the same JSON through a loader so the map pairing agrees with SQL.
- `intelligence_rules(id, entity cargo|vessel, field, condition lt|gt|eq|ne|between|missing, threshold jsonb, severity good|info|warning|danger, tag, message, active, sort_order, updated_by, updated_at)` + `intelligence_rule_groups` for the "future frameworks" (compat, portres, agecrg, freight, comm) + seed of the prototype's R-001…R-010; `get_intelligence_rules()` (authenticated, active only); admin writes service role + `p_actor`.
- `lib/intelligence/evaluate.ts` (pure) replacing the hard-coded flag functions in the portal cards/tooltips (survey `components/portal/*` for the `rule*`/`FieldRow`/`HoverTip` equivalents); `scripts/rules-check.ts`.
- Admin pages `/admin/matching-rules` (owner-only: parameter cards with slider/stepper, safe range, default, "n parameters modified", reset-all with confirm, last-changed audit, optional dry-run count of matches that would change) and `/admin/intelligence-rules` (rules CRUD + active toggle; frameworks tab; the safety questions page stays at `/admin/safety-questions`, renamed "Safety questions" in the nav — done in the scaffold).
- DOWN file `supabase/rollback/20261003_rules_down.sql`.

---

## 4. Contracts (frozen at r1; change only via the architect)

### 4.1 Fuel price index — provided by B, consumed by S (and later the PDA route estimator)
SQL: `public.get_fuel_price_index(p_port_locode text default null, p_product_keys text[] default null, p_as_of timestamptz default now()) returns jsonb`, `security definer`, `grant execute … to authenticated, service_role`.
Returns:
```json
{ "asOf": "2026-10-03T06:00:00Z",
  "port": "AEFJR",              // the port actually used (requested, else fallback)
  "scope": "port|region|global", // how far it had to fall back
  "products": [
    { "key": "VLSFO", "label": "VLSFO", "family": "residual", "sulphurClass": "VLS",
      "bestUsdMt": 611.0, "medianUsdMt": 618.5, "highUsdMt": 630.0,
      "quoteCount": 3, "freshness": "current|stale", "latestQuoteAt": "…", "normalised": true }
  ],
  "spreads": { "hsfoVlsfo": -95.0, "vlsfoLsmgo": 212.0 },
  "noOffer": ["ULSFO"] }
```
Rules: only quotes with `valid_until >= as_of` and age ≤ 14 d count (expired never count); `bestUsdMt` = min normalised (price + barge fee + mandatory charges, per MT at min qty); never 0 — a product with no live quote appears in `noOffer` and not in `products`; fallback order port → same trading zone (`ports.zone`) → global, reported in `scope`.
TypeScript (in `sdk/app/bunker.ts`, owned by B): `export type FuelPriceIndex = …; export async function getFuelPriceIndex(supabase, params: {portLocode?: string; productKeys?: string[]; asOf?: string}): Promise<FuelPriceIndex>`.
Until B lands, S compiles against the type in `lib/bunker/types.ts` (B creates this file in the scaffold-level commit **first**, within its first hour, and announces it) and uses `FUEL_FALLBACK` behind an explicit "no live index" banner.

### 4.2 Suez estimate — provided by S, consumed by S (voyage engine) and later by the Fixture/PDA hand-off
`lib/suez/engine.ts`: `estimateSuezTransit(input: SuezInput, ctx: SuezTariffContext): SuezEstimate` (pure). `SuezInput` = vessel facts (scnt, scgt, gt, category, buildYear, craneCount, craneSwlMt, searchlightCompliant, firstTransit) + voyage facts (direction, cargoStatus, transitDate, heavyLiftOver250t, militaryOrDgCargo, lateArrivalBand none|b1|b2|b3, notReady, deckProtrusionFt, wasteNormalM3, wasteHazardousM3, bagsM3, bargeHours) + overrides. `SuezEstimate` = `{ tariffVersion, sdrRate, layers: { toll: {sdr, usd, tiers[]}, fixed: Line[], conditional: Flag[] (each {code, label, triggered, potentialUsd, appliedUsd, reason}), waste: Line[] }, totals: {appliedUsd, potentialUsd}, transitDays, anchorageDays, warnings[] }`. The voyage engine adds `totals.appliedUsd` as a voyage cost and `transitDays + anchorageDays` as voyage days.

### 4.3 `app_settings.voyage_settings` (S owns; admin edits on `/admin/voyage-data`)
```json
{ "speeds": {"ladenKn": 12.5, "ballastKn": 13.0},
  "seaMargin": {"defaultPct": 5, "byLane": {"E.MED>AG": 7}, "bySeason": {"winter": 2}},
  "portTimeDays": {"loadDefault": 1.5, "dischDefault": 1.5, "idleSharePct": 20},
  "anchorageDaysDefault": 0,
  "suez": {"transitDays": 1, "anchorageDays": 0.5, "nm": 100},
  "opex": {"crewUsdDay": 1450, "maintenanceUsdDay": 800},
  "classMultipliers": {"A": 2.2, "B": 1.5, "C": 1.0},
  "eca": {"fuelProductKey": "LSMGO"},
  "fuelFallback": {"VLSFO": 585, "LSMGO": 725, "HSFO380": 450, "MGO05": 700} }
```

### 4.4 `app_settings.matching_rules` (R owns)
```json
{ "dwtTolerancePct": 10, "partCargoTolerancePct": 20, "laycanBeforeDays": 21, "laycanAfterDays": 14,
  "rateAlignmentUsd": 5, "stowageVolumeCheckFt3": 50, "vesselAgeSoftLimitYr": 20,
  "minScoreLabel": "Possible", "score": {"dwtTight": 2, "dwtLoose": 1, "zoneLoad": 2, "zoneDisch": 1, "gear": 1, "zoneWeightPct": 30},
  "updatedBy": null, "updatedAt": null }
```
Defaults equal today's literals, so enabling the table changes nothing until an admin edits it.

### 4.5 Vessel economics profile (S owns; R may read for intelligence rules such as "VLSFO sea > 28")
`lib/voyage/types.ts#VesselEconomicsProfile` — the jsonb shape in §3.1. R reads it through `sdk/app/voyage.ts#getVesselEconomicsProfile` only.

### 4.6 Shared registries (scaffold, §6) — nobody edits these again in a stream branch
`lib/admin/sections.ts`, `lib/admin/nav.ts`, `package.json` (`scripts` + `prebuild`), the four check-script stubs. If a stream needs another registry change, it asks the architect in the mailbox (`O2x`/`x2O`), who commits it to `feature/econ-scaffold` and announces `SCAFFOLD UPDATED <sha>`; streams rebase or merge that commit.

---

## 5. Priorities and milestones (owner: "as soon as possible")

| Phase | Target | S (Opus) | B (Opus B) | R (Codex) |
|---|---|---|---|---|
| **P0 — today** | plan, scaffold, worktrees, contracts | scaffold commit; worktrees + `npm ci`; onboarding | read onboarding; `lib/bunker/types.ts` + `sdk/app/bunker.ts` signature first | read plan; ACK in mailbox; survey where card flags are hard-coded |
| **P1 — engines & data (day 1–3)** | everything calculable from data | Suez tables + tiers + SDR + engine + `suez-check` (RUBATO fixture); vessel economics profile; ECA split; `voyage_settings` + voyage engine + `voyage-check` | products/suppliers/quotes schema + `get_fuel_price_index` + `get_bunker_ticker` + `bunker-check`; `fuel_prices` migration; live `BunkerTicker` | `matching_rules` key + `fn_matching_params` + matcher/view/mirror wired + `rules-check`; `intelligence_rules` table + seed + evaluate lib |
| **P2 — screens (day 3–5)** | member + admin UIs | `/dashboard/suez-toll` (rail Record/Manual, three layers, risk flags, waste, export); `/dashboard/voyage-estimator` (legs with ECA split, fuel by product, opex, Suez link, PDA link, save); `/admin/voyage-data` | supplier portal; admin bunker rebuild; `/api/bunker/ingest` decision | `/admin/matching-rules`; `/admin/intelligence-rules`; card flags driven by data |
| **P3 — proof & release (day 5–7)** | green gates, composition, production | e2e, cross-audit of B and R | e2e, hand-off | e2e, composition, release manifest, DOWN parity |

Within each stream the order is fixed: **schema + pure engine + check script → RPC/SDK → admin page (so data can be loaded) → member page → e2e**. A stream that is blocked on a contract uses the documented fallback and keeps moving.

Gating decisions already taken (owner may override):
- Suez and Voyage pages stay **admin-only** until a published Suez tariff version and a live fuel index exist in production; then they open to **T3+** (the existing `isCalculatorLocked` gate).
- Supplier portal access is by **admin invitation** (membership row), not self-signup; the ticker CTA keeps the mailto.
- No commit to `dev`, no push, no production migration or deploy without the owner's explicit approval (as before).

Open inputs needed from the owner (blocking only the *values*, not the build):
1. The current **SCA tolls circular** (SDR per SCNT tiers per vessel category, laden/ballast) — or confirm we seed the structure and the admin types the tiers.
2. The **RUBATO** proforma/estimate (golden fixture) and the SDR rate used.
3. Which bunker suppliers to invite first and their contact person, so the supplier portal can be tested with a real account.

---

## 6. Scaffold commit (`feature/econ-scaffold`, by the architect, P0)
- `lib/admin/sections.ts`: add `voyagedata → /admin/voyage-data`, `matching → /admin/matching-rules` (OWNER_ONLY), `intelligence → /admin/intelligence-rules`; presets: `it` gets `voyagedata: edit, intelligence: edit`; `broker` gets `voyagedata: view, intelligence: view`.
- `lib/admin/nav.ts`: Platform data gains "Voyage estimator data", "Intelligence rules" (new route), "Matchmaking rules" (superOnly); the existing safety item is relabelled "Safety questions".
- `package.json`: `test:suez`, `test:voyage`, `test:bunker`, `test:rules` → `scripts/{suez,voyage,bunker,rules}-check.ts` stubs (each prints "scaffold stub · 0 checks" and exits 0) appended to `prebuild`. Each stream replaces **only its own** stub.
- `docs/plan/voyage-economics-program.md`: a copy of this file (git history); the live copy stays here in the coordination folder.

---

## 7. Working rules for three agents on one machine (16 GB RAM, 4 CPUs, one Docker Supabase)

1. **Run lock (global, all three).** Before any heavy run — `next build`, Playwright, `db-rebuild.sh`, harness scripts, `npm ci`, `tsc` on the whole project — read the top 20 lines of the other two mailboxes; if any `RUN START` has no matching `RUN DONE`, wait. Post `` `RUN START <what> (<ETA min>)` `` in your own mailbox, run, then `` `RUN DONE — <result>` ``. Light checks (`node --import tsx scripts/<x>-check.ts`, targeted `eslint`) are free. No long-lived `next dev` servers; if you need a server for e2e, build and `next start` on your own port (S: 3101, B: 3102, R: 3103) and stop it when done.
2. **Local database.** The shared local `postgres` database is everyone's. Apply only **your own** migrations to it, under the run lock, and announce the versions. Never run `db-rebuild.sh` or any DOWN file against `postgres`; destructive proofs go to isolated databases: `asb_voyage` (S), `asb_bunker` (B), `asb_rules` (R) — `create database asb_x` from `postgres`, then `db-rebuild.sh --db asb_x`. Seed data you create carries a stream tag (`src:bunker-e2e` etc.) and you remove it after the run.
3. **Branches.** Branch from `feature/econ-scaffold`. Commit on your own branch only; never touch another stream's worktree or branch; no `git stash` (shared stash stack — use WIP commits). No push without the owner.
4. **Shared files.** §4.6 registries are frozen. `lib/portal/econ.ts`, `components/portal/calculators.tsx`, `lib/portal/data.ts#loadFuelPrices` belong to S except `loadFuelPrices`, which B re-points to the index in one small commit announced in the mailbox. `lib/portal/matching.ts` belongs to R.
5. **Migrations.** Your block only (§3). Every migration is idempotent where practical, has a DOWN file, revokes member access by default and grants explicitly. Record the version in `supabase_migrations.schema_migrations` when applying by hand (the harness pattern from the 30 Sep release).
6. **Privacy rules carry over.** No hidden vessel identifiers or counterparty identities in any output; supplier contacts stay behind the contact firewall; member-facing RPCs return no raw ids they do not own.
7. **Mailbox cadence.** Check the other mailboxes before a work block, after every commit, before touching a contract, and at least hourly. Use request ids: `O2C/C2O` (Opus↔Codex), `O2B/B2O` (Opus↔Opus B), `C2B/B2C` (Codex↔Opus B). Status words `OPEN / ACK / DONE / BLOCKED`; only the author changes the status.
8. **Definition of done per stream.** Check script with golden fixtures green; `tsc --noEmit` 0; targeted eslint clean; migrations + DOWN proven on the isolated DB (apply → suites → DOWN → fingerprint identical → re-apply); Playwright for the new screens green on 3101/3102/3103 against the shared local; hand-off entry in the mailbox with branch, full SHA, files, commands, results, risks.
