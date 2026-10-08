# PDA tariff package — Bulgarian Ports Infrastructure (BPI): Varna and Burgas

This is a **review package**. Nothing in it is loaded into any database.

- **Ports:** BGVAR and BGBOJ, the public-transport ports under Art. 106a.
- **Currency:** EUR.
- **Version date:** 2026-03-05.

It feeds the governed PDA path: register the sources → draft → replace rules → submit → publish, with maker ≠ checker.

| File | Content |
|---|---|
| `rules.json` | 7 rules in the exact shape `pda_replace_tariff_rules` takes |
| `manifest.json` | the 4 BPI sources (SHA-256 of each member of `tmp/Data/BULGARIAN PORTS.zip`), dependency, known limits |
| `SOURCE-EXTRACTION.md` | verbatim extraction (Bulgarian original + English) of the Varna and Burgas port-fee tariffs (scans, 15.11.2023), the 2026 ship-waste tariff and the 2026 price list; items read from the scans that are uncertain are marked |

The generator and its proof is `scripts/pda-bulgaria-package.ts`. It checks every rule with the real engine.

## What is automatic

- **SIT (light infrastructure fee):** 15–150 € per call by GT, from 41 GT.
- **OIT (operational fee):** 0,10 € per started LOA metre per started hour in port, roads excluded.
- **Ship waste:** indirect fees for MARPOL Annex I, IV and V by nine GT bands.
- **Departure clearance certificate:** 70 €.

## Manual lines

**ITD (access fee):** 0,59 or 0,60 € per GT, depending on the berth's district.
- The district is defined only by a meridian, and the tariff does not map districts to terminals.
- The one-only multipliers are applied by hand: ×0,72 for the 4th and later call, ×0,70 for a call without cargo, ×0,20 for cabotage.

## Read before publishing

- The OIT's "per hour" reading combines Art. 2(15) with (16); confirm it with BPI or the agent.
- The B7 effective date is handwritten.
- Pilotage, towage, mooring, agency and cargo handling are not in the BPI pack.
