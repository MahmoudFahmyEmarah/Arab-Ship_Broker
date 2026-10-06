# Egyptian port tariff package: Decree 488/2015 (+416/2019) and agency charges of 800/2016

Prepared by Stream B from the owner's source documents in `tmp/Data` (catalogue:
`Arabshipbroker-bunker/tmp/data-catalogue/catalogue_B_egypt.md`). This is a
**review package**, not a published tariff: nothing here is loaded into any
database. It feeds the PDA module's governed path (register sources → draft
version → replace rules → submit → publish, maker ≠ checker).

**Status: publishable (PDA Wave 2, 7 Oct 2026).** The former blocker (audit
C2B-007 #2: no governed flag/tariff-treatment input) is resolved by migration
`20261007300000_pda_flag_treatment.sql`. Every rule declares
`applicability.flagTreatments: ["foreign"]`; the route flow resolves the
vessel's flag state server-side through `public.flag_states`, and the engine
compares it with the port's country (UN/LOCODE prefix). A national (EG) vessel
gets no line from this foreign-USD set; an unknown flag raises MISSING_INPUT.
The load is proven in `supabase/tests/pda/flag_treatment.sql` (all 17 rules
through `pda_replace_tariff_rules`, published maker ≠ checker, rolled back).

| File | Content |
|---|---|
| `rules.foreign-usd.json` | 17 rules in the exact shape `pda_replace_tariff_rules` takes |
| `rules.deferred-cleanliness-by-class.json` | the four automatic cleanliness columns, enabled only once a call carries a confirmed tariff cargo class; they then replace `cleanliness_fee` |
| `manifest.json` | sources (one placeholder id per instrument), blockers, the proposed cargo-class mapping, known limits |

All three are generated and checked by
`node --import tsx scripts/pda-egypt-488-package.ts` (31 checks against the
real engine, `lib/pda/calculate.ts`). Regenerate with `--write`.

## Sources (register each, then substitute its id)

Every rule carries the placeholder id of the instrument its rate comes from
(`manifest.json#sources`); replace each placeholder with that document's
registered `tariff_sources.id`, never one id for all.

| Placeholder | Document | Authority | SHA-256 |
|---|---|---|---|
| `…0488` | Decree 488/2015, official Arabic gazette (Al-Waqa'i al-Misriya No. 205, 7 Sep 2015) | statutory | `b2d326ddf92b86bc895b4380efc1c66c7da142dcf629971206fd19f4e408b9ad` |
| (reference) | Decree 488/2015, English translation (35 p.) | reference; the Arabic text wins | `1da870dbdcab59fbffebe7e6d8a1d04bc401ce02a8f3c161123a72af56d2017f` |
| `…0416` | Decree 416/2019 amending 488/2015 (scanned) | statutory; referenced, no rate taken | `e8a896262882c7008ebb1ef2d61fdd569602bc42983b98fc8458a1b424e415ce` |
| `…0800` | Decree 800/2016 (agency fees Art. 45; Seamen's Club Art. 9) | statutory | `2dc69f9e1a5407f56a9da4b626a612e93d690f8e0bf2bcf5c47b5c41d1465221` |
| `…0417` | Decree 417/2019 amending 800/2016 | statutory; referenced, no rate taken | `3959483d52d8cdbcd707cc0b5349ea2ed65072749063b814d01ba615e606bafd` |

## Values: base-year face values

- **Owner ruling (5 Oct 2026): publish the 2015/2016 face values until fresh
  data is provided**. The version must say
  so where members see it: name it along the lines of "Decree 488/2015 +
  800/2016 base rates (not escalated)". When the owner supplies a current
  proforma or circular, publish a new version with the rates in force; the
  face-value version is then closed.
- **Escalation (why the face values are low).** 488/2015 raises its rates
  **5 % a year** (capped at 5× the Law 24/1983 rates). 416/2019 suspended that
  for 3 years from 8 Sep 2019. Whether it resumed after Sep 2022 is not in the
  owner's files. 800/2016 adds **+7 %/yr on EGP and +3 %/yr on USD** rates. No
  escalation is applied.
- **One tariff set per port.** Decree 488 is national; create one set per port
  (EGALY, EGDAM, EGPSD, EGSOK, …) with the same rules. Minimum towage/mooring
  hours differ by port (see the `towage` instructions).
- **Translation traps.** The English text calls the foreign USD table "national"
  and garbles some tug bands. The figures here follow the Arabic gazette.

## What the engine prices automatically, and what stays manual

| Rule code | Basis | Notes |
|---|---|---|
| `port_dues` | per GT 0.35 | per call |
| `light_dues` | per GT 0.15 | full rate; the 416/2019 reductions for calls combined with a Suez transit (−10 % / −20 %, Suez-only −25 % at Suez) cannot be entered because manual amounts are non-negative, so such calls are overstated |
| `pilotage_arrival`, `pilotage_departure` | tiered flat by GT (9 bands) | outer anchorage ↔ berth; shifting and waiting-area tables not included |
| `sailing_permit` 30, `berthing_form` 5, `seamens_club` 25 | flat | per call |
| `agency_fee` | tiered flat by GT, **up to 300,000 GT** | one-port column, first 5 days; +200 per started 10,000 GRT above 40,000 |
| `agency_fee_above_300000_gt` | **manual quote** | only above 300,000 GT; same formula, no upper limit |
| `agency_fee_adjustments` | **manual quote** | every agency call: 0 for one port ≤ 5 days; otherwise the two-port/Suez column difference and +10 %/day after day 5 |
| `cleanliness_fee` | **manual quote** | every call, with the full GT × cargo-class matrix in the instructions; never silently absent |
| `berthing_dues`, `stay_fee` | **manual quote** | USD 0.02 × GRT × days — the engine has no GT × days basis |
| `site_occupation` | **manual quote** | USD 12 × LOA × days (conditional) — no LOA × days basis |
| `towage`, `mooring` | **manual quote** | band × tugs/boats × hours with minimum tugs/hours and +100 % / +30 % surcharges |
| `waste_reception` | **manual quote** | USD 25/t, minimum 10 t, +15 % Ch. 2 administration |

**Cargo class.** The platform's cargo types (Grain / Dry Bulk / Break Bulk) are
not the tariff's classes (container / general cargo / clean bulk / unclean
bulk). `manifest.json#deferred.proposedMapping` proposes a mapping for the PDA
owner, with the user confirming the class on each estimate (Dry Bulk has no
default: clinker, coal, phosphate rock or petcoke are unclean bulk).

## Engine gaps this package exposes (for the PDA owner)

A flag/tariff-treatment input (done in Wave 2); a confirmed tariff cargo class;
compound bases (rate × GT × days, rate × LOA × days or hours, with "part unit =
unit" rounding); call patterns (two ports, Suez transit, days beyond 5);
conditional modifiers (night/holiday +30 %, outside-port +100 %, Suez-transit
light-dues reductions as a negative adjustment). With those, most of the manual
lines above become automatic.
