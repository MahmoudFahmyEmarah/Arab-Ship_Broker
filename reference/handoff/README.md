# Broker Ledger design sources (Concept 4) — reference only, not built

Vendored design source of truth for the rebuilt **Post Cargo** and **Post Vessel (position)**
flows. Nothing here is imported by the app; the live implementation lives in
`components/ledger/`.

Provenance:

- `asb/*.jsx`, `asb/*.js` — decoded from the self-extracting bundles
  `Concept 4 - Broker Ledger - Post Cargo.html` / `- Post Vessel.html` via
  `scripts/extract_concept4.mjs`. Bundle versions are authoritative (they carry
  the `PC2Bosun`/`PP2Bosun` global exports the ledger shell depends on).
- `asb/ledger-shell.jsx` — the shared "Broker Ledger" shell (`mountBrokerLedger`),
  exists only in the Concept 4 bundles.
- `mount-config-cargo.jsx` / `mount-config-vessel.jsx` — the per-page
  `mountBrokerLedger({...})` configs (steps, mand/opt predicates, templates,
  recents, reposts) from the bundle pages.
- `page-styles-*.css` — the full `<style>` blocks from the bundle pages
  (scoped DS tokens + `pp2-*` form chrome + `led-*` shell styles).
- `asb/pp2.css`, `asb/ds-scoped.css`, `README_HANDOFF.md`, `ds-bundle*.{css,js}` —
  copied from the CTO handoff package
  (`handoff_post_cargo_position/`, delivered outside the repo).

Data source of truth backing these designs:
`ArabShipBroker_UNIFIED_CargoMap_24Jul2026.xlsx` (sheets 02_VESSELS, 03_COMPANIES,
04_PORTS, 05_CLASS_MARKET_NAME, 06_CLASS_GRAIN, 07_CLASS_IMSBC, 08_CLASS_CSS,
09_VESSEL_FIELD_SPEC, 10_ENUMS, 11_VALIDATION).
