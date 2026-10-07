# PDA tariff package — İzmir (TCDD port, KEGM pilotage): USD version with manual lines

This is a **review package**. Nothing in it is loaded into any database.

**Blocked on one owner decision (TR-AUTH).** The Turkish documents name no issuer or provider, so they are registered as `reference`. The publication RPC refuses rules without trusted evidence (`official`, `agent` or `statutory`). A rolled-back load on a stand-in database stopped there (7 Oct 2026). Everything before that step succeeded: the sources, the draft and the 11 rules with their bands.

- **Port:** TRIZM (İzmir Alsancak, a TCDD port; pilotage and towage are KEGM services).
- **Currency:** USD (owner ruling 7 Oct 2026: "USD version + manual lines").
- **Version date:** 2026-01-01, taken from the port dues ("For the year 2026"). **Every USD table is undated.**

It feeds the governed PDA path: register the sources → draft → replace rules → submit → publish, with maker ≠ checker.

| File | Content |
|---|---|
| `rules.json` | 11 rules in the exact shape `pda_replace_tariff_rules` takes |
| `manifest.json` | the 5 sources (SHA-256 of each member of `tmp/Data/TURKISH PORTS.zip`), dependency, known limits |

The verbatim extraction, with table and row locations, is `../turkey-2026-review/SOURCE-EXTRACTION.md`. The generator and its proof is `scripts/pda-turkey-package.ts`. It checks every rule with the real engine, including every printed band to 10,000 GT.

## What is automatic (USD)

- **Pilotage, arrival and departure:** "Other Cargo Vessels 197+81" per service.
- **Mooring and unmooring:** "22+11", charged once per call.
- **Sanitary dues:** 0,5025 USD × NT (the printed formula, paid in TL at the daily USD rate), above 50 NT.

**Platform assumption:** the printed tables stop at 10,000 GT. Above that, the rules continue the header increment (+81 and +11 per started 1,000 GT) up to the 80,000 GT cap (TCDD principle 8). Each line says so in its label.

## Manual lines (entered in USD)

- **Port dues:** the 2026 TRY table by NT. Convert at the call date's rate.
- **Towage:** 373 + 70 per tug per service. The tug count comes from the port regulations.
- **Wharfage:** the pack prints three conflicting bases: 10+10 per service, 35+35 per 3,500 GT per day, and 0,010 USD per GT per day.
- **Anchoring:** only for stays over 72 hours. Foreign flag pays 0,004 USD per GT per day (0,006 after 168 hours).
- **Agency:** EUR Tariff No 1 (2023).
- **Supervision:** EUR, only when a supervising agent is appointed.
- **Waste fixed fee:** EUR, from the 2009/2010 tariff.

## Read before publishing

- Confirm the USD tables with a current KEGM/TCDD sheet or a recent agent proforma. T9 prints slightly different KEGM figures (202,27 + 83,17).
- Not included:
  - light dues (the pack covers Straits transits only);
  - the Chamber of Shipping contribution and freight tax (T11 contradicts itself);
  - private-terminal charges.
- Holiday (+50 %), outer-harbour (+100 %) and dangerous-goods surcharges are not applied automatically.
