# Ports Module design CSS — generator inputs

The 19 stylesheets under `src/` are the ones extracted, unchanged, from the owner's approved standalone design export
(`Arab ShipBroker Portal - Standalone (7).html`, B2ALL-061). They are the only inputs of
`scripts/design/vendor-ports-module-css.py`, which scopes every selector under `.pm-scope` and writes
`components/pda/ports-module.css`. Never edit the generated file; change an input here (or the generator) and re-run:

    python scripts/design/vendor-ports-module-css.py

(An explicit input directory and output path may still be given as the two arguments.)
