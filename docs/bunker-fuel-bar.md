# Fuel Bar — bunker suppliers, quotes, ticker and the fuel price index

Stream B of the Voyage Economics program (plan r2 §3.2, r2.1 §2–3). Owner brief:
first-hand physical bunker suppliers publish their price tables; the platform
shows each sponsor on a ticker (their exposure) and computes an index whose
**average** feeds the Voyage estimator.

## Data model (migrations `20261003100000`–`106000`)

| Table | Purpose | Member access |
|---|---|---|
| `fuel_products` | Catalogue. Key = family + sulphur class + ISO 8217 grade (`HSFO380`, `VLSFO`, `ULSFO`, `LSMGO`, `MGO05`, `MDO`); `market_label` is display only; IMO CO₂ factor by grade; `core_slot` (HSFO 380, VLSFO, LSMGO) and `eca_slot` (ULSFO). | read |
| `bunker_port_flags` | ECA zone, EU at-berth rule, open-loop scrubber ban per port (`ports` is not altered). | facts only, via `get_bunker_port_flags()` |
| `bunker_suppliers` | Supplier, verified flag, trust score, status, private contacts. `is_platform` marks the single internal "Platform (manual)" supplier. | none |
| `bunker_supplier_ports` | Normalised supplier ports (one primary). | none |
| `bunker_supplier_members` | Member accounts linked to a supplier (`editor` publishes, `viewer` reads). No new `users.role`. | none |
| `bunker_quotes` | Append-only quotes: USD/MT price, delivery mode, min stem, barge fee and mandatory charges (fixed per delivery), validity, source, status `submitted → approved/rejected/withdrawn`, `client_ref`, `superseded_at`. | none |
| `bunker_quote_events` | Audit trail (submit, approve, reject, withdraw, override, import). | none |

Content of a quote never changes (trigger): only the status decision and
`superseded_at` (once). `client_ref` is bound to `command_sha256`, the hash of
every submitted term; submissions are serialised per supplier (and per
supplier + reference), so a concurrent or repeated first use replays the same
quote and a reused reference with any different term is refused (23505). One live and one pending quote per supplier × port ×
product. Approving a quote supersedes the previous live one.

## Rules

- **Freshness** by quote age: ≤ 7 d current, 8–14 d stale (flat arrow, "·Nd"),
  15–21 d expired ("Outdated" on the ticker), > 21 d hidden. Validity lapsed = expired.
- **Index** (`get_fuel_price_index(p_port_locode, p_product_keys, p_as_of, p_stem_mt default 500)`):
  approved quotes valid at `as_of`, ≤ 14 d old, supplier enabled, applicable to
  the stem (`min_qty_mt ≤ stem`); normalised = price + (barge fee + mandatory
  charges) / stem; one quote per supplier (latest wins); `averageUsdMt` is what
  the estimator consumes; never zero (no live quote → `noOffer`); fallback port →
  same `ports.zone` (not `Unknown`) → global, as a whole request; no supplier
  identity; members see min/median/max only from 3 suppliers
  (`cohortSuppressed`); `latestQuoteAt` floored to the hour. `port` is the port
  actually used and is set only for scope `port`; a region or global answer
  returns `port: null`, `requestedPort`, `region` (region scope) and the sorted
  `contributingPorts` (architect ruling C2O-033). An empty product list is refused.
- **Ticker** (`get_bunker_ticker()`): enabled, non-platform sponsors; only quotes
  valid now (`valid_from ≤ now ≤ valid_until`), judged per product; one row per
  sponsor × port with their own prices and direction against the previous
  once-live quote; no ids or contacts. The strip distinguishes "no current offer"
  from "temporarily unavailable", pauses on hover/focus, keeps a single
  focusable copy and is static under reduced motion.
- **Snapshot** (`getFuelIndexSnapshot`, frozen B→S contract C2O-033): `trusted`
  only when every requested product has a live price, else `unavailable` with no
  prices; never a fallback of its own; `canonicalSha256` over sorted-key JSON.
- **Supplier writes** (`supplier_upsert_quotes`, `supplier_withdraw_quote`,
  `supplier_list_my_quotes`): actor from the session; editor of an enabled
  supplier; registered port; 0 < price < 10 000; validity starts within a day,
  ends in the future, lasts ≤ 60 days; ≤ 100 quotes per call, ≤ 500 per day;
  atomic; replaying a `clientRef` returns the same quote. Verified suppliers are
  approved on submission; others wait for an admin. Suppliers cannot approve,
  nor change ports or members.
- **Admin** (`admin_bunker_*`, service role + `p_actor`, re-checked: active admin,
  super tier or `admin_perms.bunker`): suppliers and ports, member links,
  overrides (or staff input under the platform supplier, approved at once, reason
  required), approve/reject/withdraw, `admin_bunker_dashboard`.

## Surfaces

- `components/portal/BunkerTicker.tsx` — dashboard, boards, calculators, Fixture Room.
- `/dashboard/bunker-supplier` — supplier portal (invitation only).
- `/admin/bunker` — current prices and approvals, overrides, suppliers & access, update history.
- `lib/portal/data.ts#loadFuelPrices` — index average for VLSFO/LSMGO with a per-product `live` flag.
- `sdk/app/bunker.ts` — the only module other streams import (`getFuelPriceIndex`, `getBunkerTicker`, `BunkerNotDeployedError`).

The legacy `public.fuel_prices` rows are copied once into `bunker_quotes`
(`104000`) and nothing reads the table any more; drop it in a later release.
The Basic-auth `/api/bunker/ingest` route was removed (its tables never existed
in production); a token-based feed, if wanted later, should use Vault like Data Sync.

## Proof

```
node --import tsx scripts/bunker-check.ts                       # 65 pure + SDK + snapshot assertions
node --import tsx scripts/bunker-sql-suite.ts | docker exec -i supabase_db_arab-ship-broker \
  psql -U postgres -d <db> -v ON_ERROR_STOP=1 -q                  # rolled-back SQL suite, same fixtures
HARNESS_PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d asb_bunker" \
  bash scripts/migration-harness.sh --chain supabase/migrations/2026100310*.sql \
  --smokes <generated suite file> --downs supabase/rollback/20261003_bunker_down.sql
bash scripts/bunker-race.sh asb_bunker                           # two-session idempotency (isolated DB only)
E2E_BASE_URL=http://127.0.0.1:3102 npx playwright test --config=playwright.bunker.config.ts
```
