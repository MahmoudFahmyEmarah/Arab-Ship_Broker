# Egyptian port tariff package: Decree 488/2015 (+416/2019) and agency charges of 800/2016

Prepared by Stream B from the owner's source documents in `tmp/Data` (catalogue:
`Arabshipbroker-bunker/tmp/data-catalogue/catalogue_B_egypt.md`). This is a
**review package**, not a published tariff: nothing here is loaded into any
database. It feeds the PDA module's governed path (register source → draft
version → replace rules → submit → publish, maker ≠ checker).

`rules.foreign-usd.json` is generated and checked by
`node --import tsx scripts/pda-egypt-488-package.ts` (22 checks against the real
engine, `lib/pda/calculate.ts`). Regenerate with `--write`.

## Sources (register these first)

| Document | Authority | SHA-256 |
|---|---|---|
| Ministry of Transport Decree No. 488 of 2015 (English translation, 35 p.) — `Ministry_of_Transport_Decree_No._488_of_2015.pdf` | reference (translation) | `1da870dbdcab59fbffebe7e6d8a1d04bc401ce02a8f3c161123a72af56d2017f` |
| Decree 488/2015, official Arabic gazette (Al-Waqa'i al-Misriya No. 205, 7 Sep 2015) — `EGY 3.Ministerial Decree No.488 of 2015 …pdf` | statutory | `b2d326ddf92b86bc895b4380efc1c66c7da142dcf629971206fd19f4e408b9ad` |
| Decree 416/2019 amending 488/2015 (Arabic, scanned) — `EGY4. Ministerial Decree No.416 of 2019 …pdf` | statutory | `e8a896262882c7008ebb1ef2d61fdd569602bc42983b98fc8458a1b424e415ce` |
| Decree 800/2016 (agency fees, Ch. 10 Art. 45; Seamen's Club Art. 9) — `EGY 2.nisterial Decree No.800 of 2016 …pdf` | statutory | `2dc69f9e1a5407f56a9da4b626a612e93d690f8e0bf2bcf5c47b5c41d1465221` |

The JSON carries the placeholder source id `00000000-0000-4000-9000-000000000488`;
replace it with the registered `tariff_sources.id` before pasting.

## Before publishing — the values are base-year, not current

- **Escalation.** 488/2015 raises its rates **5 % a year** (capped at 5× the Law
  24/1983 rates). 416/2019 suspended that for 3 years from 8 Sep 2019. Whether it
  resumed after Sep 2022 is not in the owner's files. 800/2016 adds **+7 %/yr on
  EGP and +3 %/yr on USD** rates. The JSON holds the **face values**; confirm the
  rates in force with the port authority or a current agent proforma, and set
  `effective_from` accordingly. Do **not** publish the face values as current.
- **One tariff set per port.** Decree 488 is national; create one set per port
  (EGALY, EGDAM, EGPSD, EGSOK, …) with the same rules. Minimum towage/mooring
  hours differ by port (see the `towage` instructions).
- **Translation traps.** The English text calls the foreign USD table "national"
  and garbles some tug bands. The figures here follow the Arabic gazette.

## What the engine prices automatically, and what stays manual

| Rule code | Basis | Notes |
|---|---|---|
| `port_dues` | per GT 0.35 | per call |
| `light_dues` | per GT 0.15 | 416/2019 reductions for Suez transits (−10 % / −20 %, Suez-only −25 % at Suez) → manual adjustment |
| `pilotage_arrival`, `pilotage_departure` | tiered flat by GT (9 bands) | outer anchorage ↔ berth; shifting and waiting-area tables not included |
| `cleanliness_fee_{container,general_cargo,clean_bulk,unclean_bulk}` | tiered flat by GT × cargo column | **the request must carry `cargoType` = one of these four values**, otherwise no cleanliness line is produced |
| `sailing_permit` 30, `berthing_form` 5, `seamens_club` 25 | flat | per call |
| `agency_fee` | tiered flat by GT | one-port column, first 5 days; +200 per started 10,000 GRT above 40,000 (stepped to 300,000 GT); extra days +10 %/day → manual |
| `berthing_dues`, `stay_fee` | **manual quote** | USD 0.02 × GRT × days — the engine has no GT × days basis |
| `site_occupation` | **manual quote** | USD 12 × LOA × days (conditional) — no LOA × days basis |
| `towage`, `mooring` | **manual quote** | band × tugs/boats × hours with minimum tugs/hours and +100 % / +30 % surcharges |
| `waste_reception` | **manual quote** | USD 25/t, minimum 10 t, +15 % Ch. 2 administration |

"Foreign flag" is represented by `voyageScopes: ["international"]` because the
engine has no flag field; national (EGP) rates are not included.

## Engine gaps this package exposes (for the PDA owner)

Compound bases (rate × GT × days, rate × LOA × days or hours, with "part unit =
unit" rounding), yearly escalation per decree, flag/currency selection, and
conditional modifiers (night/holiday +30 %, outside-port +100 %, Suez-transit
light-dues reductions). With those, five of the six manual lines above become
automatic.
