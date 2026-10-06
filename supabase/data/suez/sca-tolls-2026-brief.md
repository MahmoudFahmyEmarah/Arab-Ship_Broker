# Suez Canal tolls — what the public record gives us (researched 5 Oct 2026)

Prepared for the owner's Voyage Economics inputs (SCA toll bands, SDR rate, RUBATO, maker/checker).
Everything below is from public sources; each figure says where it comes from. Nothing here has been
loaded into any database yet — loading is an admin action on `/admin/voyage-data` (see "How to load").

## 1 · Base transit dues (the toll bands) — OFFICIAL, on file

Source: Suez Canal Authority, **"Transit Dues Rates" Schedules applicable from the 15th of January 2024**
(document created 17 Oct 2023; published as `english72023.pdf` under the SCA Navigation Circulars).
- File: `tmp/Data/SCA-Transit-Dues-Rates-Schedules-from-15-Jan-2024 (english72023.pdf).pdf` (325,826 bytes)
- SHA-256: `1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f`
- URL: https://www.suezcanal.gov.eg/Arabic/Navigation/NavigationCirculars/Documents/english72023.pdf
- Still the base: the July 2026 surcharge reporting states the base tariff "has not been adjusted since 2024".

SDR per SCNT, cumulative bands (first 5,000 / next 5,000 / next 10,000 / next 20,000 / next 30,000 / next 50,000 / rest;
containerships have an extra "next 60,000" band before "rest"):

| Rate | SCA category | Our key | Laden (7 or 8 bands) | Ballast |
|---|---|---|---|---|
| 1 | Crude oil tankers | `tanker_crude` | 11.04 / 7.82 / 5.91 / 2.93 / 2.53 / 2.17 / 2.13 | 9.40 / 6.64 / 5.04 / 2.50 / 2.14 / 1.85 / 1.82 |
| 2 | Petroleum product tankers | `tanker_product` | 11.04 / 7.82 / 5.91 / 3.93 / 3.84 / 3.46 / 3.34 | 9.40 / 6.64 / 5.04 / 2.50 / 2.14 / 1.85 / 1.82 |
| 3 | Dry bulk vessels | `dry_bulk` | 10.13 / 7.74 / 6.12 / 2.24 / 1.97 / 1.85 / 1.77 | 8.62 / 6.58 / 5.21 / 1.89 / 1.68 / 1.58 / 1.50 |
| 4 | LPG carriers | `lpg` | 11.60 / 8.40 / 6.22 / 5.05 / 4.42 / 4.13 / 4.13 | 9.87 / 7.14 / 5.29 / 4.30 / 3.76 / 3.51 / 3.51 |
| 5 | LNG carriers | `lng` | 10.42 / 8.11 / 7.02 / 5.43 / 5.03 / 4.80 / 4.67 | 8.87 / 6.89 / 5.97 / 4.61 / 4.27 / 4.08 / 3.97 |
| 6 | Chemical & other liquid bulk tankers | `chemical_tanker` | 11.55 / 8.92 / 7.12 / 5.19 / 4.63 / 4.35 / 4.27 | 9.81 / 7.58 / 6.06 / 4.42 / 3.94 / 3.70 / 3.63 |
| 7 | Containerships (8 bands) | `container` | 11.04 / 7.58 / 5.89 / 4.13 / 3.82 / 3.01 / 2.94 / 2.88 | 9.40 / 6.45 / 5.00 / 3.51 / 3.25 / 2.56 / 2.52 / 2.44 |
| 8 | General cargo / MPP / heavy lift | `general_cargo` | 10.08 / 7.78 / 5.42 / 4.07 / 3.94 / 3.87 / 3.80 | 8.58 / 6.62 / 4.61 / 3.45 / 3.36 / 3.30 / 3.22 |
| 9 | Ro-Ro | `roro` | 10.08 / 7.50 / 5.83 / 4.21 / 3.94 / 3.80 / 3.65 | 8.58 / 6.37 / 4.97 / 3.59 / 3.36 / 3.22 / 3.12 |
| 10 | Vehicle carriers | `car_carrier` | 11.04 / 7.58 / 5.67 / 4.05 / 3.82 / 3.01 / 2.88 | 9.40 / 6.45 / 4.83 / 3.45 / 3.25 / 2.56 / 2.44 |
| 11 | Cruise ships | `passenger` | 9.97 / 7.00 / 5.77 / 4.08 / 4.03 / 3.90 / 3.76 | 8.48 / 5.96 / 4.91 / 3.48 / 3.42 / 3.31 / 3.19 |
| 12 | Special floating units (laden only) | `floating_unit` (new key) | 11.98 / 7.94 / 7.14 / 5.06 / 4.76 / 4.31 / 4.16 | — |
| 13 | Other vessels | `other` | 10.54 / 7.10 / 5.97 / 4.35 / 4.21 / 3.94 / 3.80 | 8.96 / 6.04 / 5.08 / 3.70 / 3.59 / 3.36 / 3.22 |

Notes printed on the schedule: ballast product tankers and ballast oil/chemical tankers pay ballast crude rates;
laden OBO pays the rate of the carried cargo (highest if mixed), ballast OBO pays ballast dry-bulk rates; special
floating units = yachts, dredgers, rigs, floating docks, fishing vessels, navy ships, tugs, research vessels.

Ready to paste: `supabase/data/suez/sca-transit-dues-2024-toll-bands.csv` — 177 rows in the admin "Replace all bands (CSV)" format
(category, cargo_status, band_no, scnt_from, scnt_to, sdr_per_scnt; bands contiguous from 0, last band open).
Worked check: dry bulk laden 16,070 SCNT = 126,498.40 SDR; 60,000 SCNT = 234,750.00 SDR; container laden 130,000 SCNT = 529,100.00 SDR
(the May 2025 reporting quotes "≈500,000 SDR" for a 130,000-ton container ship — consistent).

## 2 · Temporary surcharges on the base dues — in force since 15 July 2026 (NOT yet modelled)

Amended by SCA periodicals/circulars of 7 June 2026, "temporary … may be amended or cancelled according to the maritime market conditions":

| Class | Before | From 15 Jul 2026 | Instrument |
|---|---|---|---|
| Crude oil tankers — laden (Rate 1L) | 25 % | **37 %** of normal transit dues | Periodical 16/2026 amending Circular 1/2022 (transcribed by Sealagom) |
| Crude oil tankers — ballast (Rate 1B) | 15 % | **27 %** | Periodical 16/2026 |
| Petroleum product tankers — laden | 25 % | **37 %** (ballast 27 %) | reported (meobserver, Splash, Leth) — periodical number not yet confirmed |
| LPG carriers | 20 % | **32 %** | reported |
| Chemical tankers | 20 % | **32 %** | reported |
| LNG carriers | 7 % | **19 %** | reported |
| **Dry bulk vessels (Rate 3)** | 10 % | **22 %** | **Periodical 18/2026** amending Circular 3/2022 (SCA page title confirmed; text not yet retrieved) |
| General cargo / heavy lift / vehicle carriers | 14 % | **26 %** (ISS: vehicle carriers NB 26 %, SB 12 %) | reported |
| Ro-Ro | 14 % | **26 %** | reported |
| Containerships (laden/ballast) | — | **12 %** of total transit dues incl. weather-deck tier surcharges | Circular 2/2026 (KADMAR transcription) |
| Passenger / cruise | exempt | exempt | reported |

What this means for the calculator: the surcharge is a per-category percentage of the toll (tankers also by laden/ballast).
Our tariff items carry direction and cargo-status scopes but **no category scope** — a small follow-up (one migration +
engine + admin field) is needed before these can be loaded as governed data. Until then the toll layer prices the base
dues only and must say so.

## 3 · Rebates / incentives

- Periodical 1/2026 (24 Feb 2026) — provisions extended six months to 31 Jan 2027 by Periodical 28/2026 (7 Sep 2026). Content to be transcribed (see sealagom message 41443).
- 2025: 15 % discount for containerships ≥ 130,000 SCNT (May 2025, 90 days), later suspended/withdrawn early (container-mag, hellenicshippingnews).
- 2023 route rebates (Circulars 2/2023, 3/2023) for US Gulf/Caribbean → Asia tankers — historical.
Rebates are per route/class and change often; model them only when the owner wants a specific one.

## 3b · Other 2026 instruments seen (not tolls)
- Circular 3/2026 (1 Jul 2026, effective 15 Jul 2026): **Port Said port pilotage dues** (USD by NT band, e.g. up to 999 NT from/to sea $201.42, 1,000–4,999 $329.27, 60,000+ $3,933.05; night +50 %; +5 % yearly from 1 Jul 2027) — port-call pilotage, not canal transit → belongs to the Ports DA module.
- Periodical 29/2026 (28 Sep 2026): transit dues of previous transits re-settled on SCNT when the missing tonnage documents arrive by the 3rd transit within six months of the first — a settlement rule, no new charge.

## 4 · SDR → USD rate — OFFICIAL

IMF "SDRs per currency unit and currency units per SDR — last five days" (https://www.imf.org/external/np/fin/data/rms_five.aspx):

| Date | USD per SDR | SDR per USD |
|---|---|---|
| 2 Oct 2026 | **1.354080** | 0.738509 |
| 1 Oct 2026 | 1.355950 | 0.737489 |
| 30 Sep 2026 | 1.359750 | 0.735432 |
| 29 Sep 2026 | 1.358850 | 0.735915 |
| 28 Sep 2026 | 1.359830 | 0.735386 |

Record in the admin as: as of 2026-10-02, 1.354080, source "IMF", note "IMF representative rate, rms_five".

## 4b · Loaded on the local stack (5 Oct 2026, ~01:00) — governed v3, published
Source record for the SCA schedule registered **on file** (SHA-256 above), draft v3 copied from v2 (29 accompanying/conditional/waste items, citations carried + the new source), **177 official bands**, IMF rate 2026-10-02 = 1.354080, v2 closed 2026-10-04, v3 published 2026-10-05 → open; every step carries the owner's admin as actor in `suez_tariff_events` (18 events). `get_suez_tariff_context(2026-10-05)` → v3, 177 tiers, SDR 1.354080, 6 sources, `suez-engine/2`.

**Reconciliation with the RUBATO proforma (Elephant Marine, 27 Apr 2026; now on file, SHA-256 `03d24c80…c510`):** SCNRT 15,836.28, dry bulk laden SB, SDR 1.38 → engine toll on the official bands = 125,066.32 SDR = USD 172,591.52; × 1.10 (the Circular 3/2022 dry-bulk surcharge in force in April 2026) = **USD 189,850.67 vs. proforma 189,854** (the USD 3 gap is the SCA charging the fractional 0.28 SCNT; the engine takes whole tons). Accompanying lines: proforma 11,221 (v1 mooring 3,500) vs. engine 11,521 under v3 (Circular 1/2026 mooring 3,800 for GT ≥ 2,500) — the +300 is the May 2026 circular, as modelled. The owner's rate table "8.687 SDR/SCNT" was this proforma's average rate back-solved; the official bands + surcharge explain it exactly.

Today the same vessel would be 125,066.32 × 1.354080 × 1.22 = **USD 206,607** in tolls — the 22 % surcharge is the single biggest unmodelled item.

## 4c · Follow-up spec (approved by the owner for after Codex's audit of e4da2e0)
1. Migration `20261003205400`: `suez_tariff_items.category_scope text[] null` (null = any) + a `surcharge` layer value (or keep `fixed` with `pct_of_toll`), checks; `suez_toll_tiers` SCNT bands unchanged; `SUEZ_VESSEL_CATEGORIES` + category check gain `floating_unit` (Rate 12, laden only).
2. Engine: apply an item only when `categoryScope` is null or contains the vessel category; surcharge lines print "temporary — Periodical 18/2026" with the source citation; `scnt` accepts decimals (SCA charges fractional tons).
3. Admin: multi-select category scope on the item form; CSV import of surcharges; the calculator footer shows the version notes.
4. Data (governed v4): dry bulk 22 %, crude 37 L / 27 B, product 37/27, LPG 32, chemical 32, LNG 19, general cargo/heavy-lift/vehicle 26 (vehicle SB 12), ro-ro 26, containers 12 % of total dues (incl. weather-deck tiers), passenger 0 — each cited to its periodical; Periodical 18/2026 text still to be obtained from the SCA/agent.
5. Checks: suez-check golden = RUBATO proforma (189,854 with 10 %) and the same hull at 22 %; e2e asserts the surcharge line.

## 4d · Also received from the owner (5 Oct 2026)
- `PDA_RUBATO__KPFJED26000037_KING_ABDULLAH_PORT_27_Apr_2026.pdf` (Kanoo, SAR 228,236.10 incl. stevedoring SAR 8/MT; SHA-256 `ce884e59…7111`) and `Master_Account_DA_&_Suez_Tolls.xlsx` (SHA-256 `1fbfcd72…2546`) → Ports DA module evidence (King Abdullah Port tariff: berth hire SAR 2,100/day days 1–3, 3,000 from day 4; port dues 2,400; mooring/unmooring 14,878.60; garbage 400/day; Tabadul 50 + 15 % VAT).
- `Arab_ShipBroker_Master_Voyage_Estimate_v1.xlsx`, `ArabShipBroker_OPEX_Calculator_v1.xlsx`, `Voyage_Estimation_Spreadsheet1-_answer_(1).xlsx` → the owner's reference models for the voyage engine (Handymax/Panamax worked examples) — to be used as golden fixtures in a later voyage-check pass.
- `Ministry_of_Transport_Decree_No._488_of_2015.pdf` → Egyptian port tariffs (Ports DA).

## 5 · RUBATO proforma — RECEIVED and on file (5 Oct 2026)

`45_-_RUBATO_-_SB.pdf` (427,640 bytes, SHA-256 `03d24c801be4e9466f3145d3329120335703ad0b6bcc4376b1706eb389bcc510`), registered on the local stack as `on_file` with an `evidence_attached` event. Trello itself stays unreadable from the harness; files dropped into `tmp/Data` are the working path.

## 6 · Maker/checker (owner decision) — proposal

With a single admin seat the typed `PUBLISH` confirmation is the checker step today. Options:
1. **Single seat (current):** typed PUBLISH + mandatory cited source + validation at publication; the publish message records "maker = checker". Cheapest; audit trail still names the actor.
2. **Second seat:** appoint one more admin (IT or Codex-run review seat) and make `publish` refuse when `published_by = created_by`.
3. **Delayed publication:** a draft can be published only ≥ 24 h after its last edit, giving a review window.
Recommendation: option 1 now, option 2 when a second administrator exists.

## How to load (when you decide)

1. `/admin/voyage-data` → Suez tariffs → "Register a source record": title "SCA Transit Dues Rates Schedules applicable from 15 Jan 2024", issuer "Suez Canal Authority", document no. "english72023.pdf", issue date 2023-10-17, effective from 2024-01-15, authority official, evidence on file, SHA-256 above.
2. "New draft version" copied from v2, effective from the date you choose (e.g. today), source reference "SCA Transit Dues Rates Schedules from 15 Jan 2024 (base tolls)".
3. Toll bands → paste `sca-transit-dues-2024-toll-bands.csv` → confidence **official** → Replace bands.
4. SDR rate → record 2026-10-02 / 1.354080 / IMF.
5. Publish with typed PUBLISH. The calculator then prices base tolls; surcharges wait for the category-scope follow-up.
