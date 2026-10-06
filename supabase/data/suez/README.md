# Suez tariff — governed data loads (runbook)

These files rebuild the governed Suez tariff a staging or release database needs, through the same admin RPCs the
console uses (every step writes its event with the acting admin). They are data, not schema: apply them only after
the Stream S migrations `20261003200000`…`20261003205600`, once, in order.

| File | Version | What it publishes |
|---|---|---|
| `load-v3-official-bands.sql` | v3 | Registers the official SCA schedule (on file, SHA-256 below) and the IMF SDR rate (2 Oct 2026, 1.354080); 177 official toll bands; accompanying charges. |
| `load-v4-surcharges.sql` | v4 = v3 + | The temporary SCA category surcharges in force since 15 Jul 2026, each `reported` (the periodicals are not on file yet). |
| `load-v5-escort-contingent.sql` | v5 = v4 + | Escort-tug triggers (agent guide §8) and contingent charges (§26), listed, never summed. |

Supporting files: `sca-transit-dues-2024-toll-bands.csv` (the bands v3 loads) and `sca-tolls-2026-brief.md` (where
every figure comes from).

Source documents are **not** committed: the official schedule
`SCA-Transit-Dues-Rates-Schedules-from-15-Jan-2024 (english72023.pdf).pdf` (325,826 bytes, SHA-256
`1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f`) is public; the agent guide and the RUBATO
proforma are third-party and commercial. Keep them in the owner's evidence store and verify the SHA-256 before
marking a source `on_file`.

## Apply

```
# actor = the public.users.id of the admin doing the load (a real admin; the events name them)
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -v actor=<admin users.id> -1 -f supabase/data/suez/load-v3-official-bands.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -v actor=<admin users.id> -1 -f supabase/data/suez/load-v4-surcharges.sql
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -v actor=<admin users.id> -1 -f supabase/data/suez/load-v5-escort-contingent.sql
```

Each file is one transaction and ends by printing the version in force. Production is an owner action: the
owner runs it from their own shell after the release migrations, never an agent.

## Check

```
select c -> 'version' ->> 'versionNo', jsonb_array_length(c -> 'items'), c -> 'sdr' ->> 'rateUsd'
  from public.get_suez_tariff_context(current_date) c;
```

Expected after v5: version 5, the escort item (`conditionKey = escort_tugs`) and four contingent items present, SDR
1.354080 unless a later rate was recorded.
