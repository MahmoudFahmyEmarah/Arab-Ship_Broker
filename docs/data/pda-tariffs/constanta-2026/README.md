# PDA tariff package — CN APM S.A. Constanta, valid as from 15.09.2026

This is a **review package**. Nothing in it is loaded into any database. It feeds the governed PDA path:

1. register the sources;
2. create a draft version (ROCND, EUR, effective 2026-09-15);
3. replace the rules with `rules.json`, mapping each placeholder `sourceId` to its registered source;
4. submit;
5. publish, with maker ≠ checker.

The owner set the load order on 5 Oct 2026: Egypt first, then Constanta.

| File | Content |
|---|---|
| `rules.json` | 16 rules in the exact shape `pda_replace_tariff_rules` takes |
| `manifest.json` | sources (one placeholder id per official PDF, with SHA-256 inside `tmp/Data/ROMANIA PORTS.zip`), dependency, known limits |
| `SOURCE-EXTRACTION.md` | verbatim extraction of tariffs 1.1, 1.2, 1.3, 1.5, 1.9 and 1.10, with page markers, inconsistencies and open questions |

The generator and its proof is `scripts/pda-constanta-package.ts`. It checks every rule with the real engine and confirms that the committed JSON equals its output.

## What is automatic

These charges are calculated from the printed rates for a bulk carrier:

- **Access:** 0.155 €/GT per entry.
- **Pilotage:** entry and exit, 0,102 / 0,067 / 0,047 / 0,041 / 0,037 / 0,037 €/GT per manoeuvre, with a minimum of 114 € in the 0-5000 group.
- **Safety and security:** 0.080 €/GT, minimum 215 €.
- **Waste:** 191 €/call plus 0.027 €/GRT, with GRT capped at 35,000, so the maximum is 1,136 €.
- **Dockage for grain (2.7(b), other cargoes):** € per LOA metre per day, by GT group.

## What is a manual line, and why

- **Basin (1.3):** the unit is ambiguous. The page prints €/UTB, but its text says LOA × days.
- **Dockage for Dry Bulk / Break Bulk:** the tariff cargo class decides the rate. The listed cargoes are coal, ores, phosphates, apatite and bauxite; anything else is "other".
- **Dockage for other vessel types:** the 2.8 tables.
- **Towage:** CN APM publishes no rates; the licensed operators quote.

## Depends on

**`20261007310000_pda_fx_rates`.** The route view shows USD, so an admin must record a governed EUR → USD rate first. Until then every Constanta leg shows "FX rate required".

## Known limits

These are listed in `manifest.json`:

- surcharges and discounts on pilotage and access;
- extra pilotage manoeuvres (shifting, split legs);
- the days rule for dockage;
- the green waste reduction;
- charges outside the CN APM pack: towage, mooring, Romanian Naval Authority fees, light dues, agency, sanitary, cargo handling.
