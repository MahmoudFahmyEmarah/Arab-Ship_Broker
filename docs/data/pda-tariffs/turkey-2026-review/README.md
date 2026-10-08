# Turkey (TCDD / KEGM / TDİ / Ministry ports): review dossier, NOT a loadable package

> **7 Oct 2026, owner ruling (b) "USD version + manual lines":** the loadable İzmir package built from this dossier is `../turkey-izmir-2026/`. The blockers below still describe what that package leaves manual or assumed.

This folder holds a verbatim extraction of the Turkish tariff documents in `tmp/Data/TURKISH PORTS.zip`, in `SOURCE-EXTRACTION.md`. The extraction gives the SHA-256 of each member and table and row locations. **It is deliberately not packaged as PDA rules.** Packaging it now would mean guessing.

## Why it is not loadable yet (blockers for the owner and the PDA owner)

1. **Several currencies in one call.**
   - Port dues are in **TRY** (T6, "For the year 2026").
   - Pilotage, towage, mooring, wharfage and anchoring are in **USD** (T12).
   - Agency, supervision and waste are in **EUR** (T1, T8, T12 Annex 1).
   - Sanitary dues are USD converted to TRY at the daily rate.
   - The PDA engine prices one tariff version per port, in one currency. A faithful Turkish PDA needs either per-scope tariff sets combined per call (an engine change) or governed FX conversion inside a version.
2. **Undated sources.**
   - Only T6 (port dues) and T11 (Chamber of Shipping) say 2026.
   - Agency is from Gazette 32314 (19.09.2023).
   - Supervision and protecting agency are from 2008, and the waste annex is from 2009/2010.
   - **Every TCDD/KEGM/TDİ/Ministry USD table in T12 is undated.** KEGM revises them yearly.
3. **Contradictions between documents.**
   - TCDD and Ministry towage notes disagree: 283 + 53 vs 255 + 48.
   - The T9 KEGM rates (202,27 / 83,17 …) differ from T12 (197 + 81 …).
   - The Ministry mooring rows above 10,000 GT break the 22 + 11 pattern.
   - TCDD wharfage is "per service" in T12 but per day in T9.
   - Two anchoring regimes conflict.
   - The Chamber of Shipping maximum for "100001 and over" is 200 in one table and 1780 + 1780 in another.
4. **Tables stop at 10,000 GT.** The 80,000 GT cap is printed only for TCDD. Whether the per-1,000 GT increments continue above 10,000 GT at other authorities is not printed.
5. **Light dues** (T2) cover Straits transits only. There is no port-call light-dues rate in the pack.
6. **Private terminals.** Most Turkish bulk terminals are private, and their berth and wharfage tariffs are not in the pack.

## What would unblock it

- Current (2026) KEGM/TCDD tariff sheets, or an agent's recent proforma, to confirm the USD tables.
- An owner decision on multi-currency PDAs:
  - (a) engine support for several tariff sets (scopes) per port, each in its own currency, combined in the route view through governed FX; or
  - (b) one USD version, with TRY and EUR items as manual lines.
- The target terminal(s) for bulk calls, and their operator tariffs.

The 18 open questions at the end of `SOURCE-EXTRACTION.md` list the rest.
