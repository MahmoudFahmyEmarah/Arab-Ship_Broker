# PDA tariff package — Piraeus Port Authority S.A. (PPA) port zone, cargo ships, 2026

This is a **review package**. Nothing in it is loaded into any database. It feeds the governed PDA path:

1. register the sources;
2. create a draft version (GRPIR, EUR, effective 2026-05-01);
3. replace the rules with `rules.json`, mapping each placeholder `sourceId` to its registered source;
4. submit;
5. publish, with maker ≠ checker.

The owner set the load order on 5 Oct 2026: Egypt → Constanta → Greece.

| File | Content |
|---|---|
| `rules.json` | 8 rules in the exact shape `pda_replace_tariff_rules` takes |
| `manifest.json` | sources (one placeholder id per official PDF, with SHA-256 inside `tmp/Data/GREEK PORTS.zip`), dependency, known limits |
| `SOURCE-EXTRACTION.md` | verbatim extraction of the port-zone tariff, the liquid and solid waste systems and the tug regulation, with pages, inconsistencies and open questions |

The generator and its proof is `scripts/pda-piraeus-package.ts`. It checks every rule with the real engine and confirms that the committed JSON equals its output.

## What is automatic

These charges are calculated for a cargo ship:

- **Port use:** 0,061 €/GT per arrival.
- **Berthing (alongside):** 1,033 € per LOA metre per started day.
- **Anchorage:** 0,397 €/GT per started 15-day block.
- **Waste:** σΤ × σΜ by GRT group. Liquid (oily) waste is 384 × σΜ, sewage 169 × σΜ and solid waste 174,75 × σΜ. The fees are prepaid, with 80 % refunded when waste is delivered; the full fee is shown.

## What is a manual line, and why

- **Mooring (600,00 € per work step):** the tariff prints no number of steps per call, and the charge applies only when the pilotage service does not moor the ship.
- **Towage:** PPA publishes no rates, only a minimum tug requirement.

## Depends on

**`20261007310000_pda_fx_rates`.** An admin must record a governed EUR → USD rate. Until then every Piraeus leg shows "FX rate required".

## Known limits

These are listed in `manifest.json`:

- the berthing day rules and discounts;
- the transit discount and the repair coefficient on waste;
- CPI indexation;
- charges outside the PPA pack: pilotage, light dues, agency, health, launch, VAT.
