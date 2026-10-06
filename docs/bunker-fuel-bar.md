# Fuel Bar — bunker suppliers, quotes, ticker and the fuel price index

Stream B of the Voyage Economics program (plan r2 §3.2, r2.1 §2–3). Owner brief:
first-hand physical bunker suppliers publish their price tables; the platform
shows each sponsor on a ticker (their exposure) and computes an index whose
**average** feeds the Voyage estimator.

## Data model (migrations `20261003100000`–`111000`)

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
`superseded_at` (fixed once it has taken effect). `client_ref` is bound to `command_sha256`, the hash of
every submitted term; submissions are serialised per supplier (and per
supplier + reference), so a concurrent or repeated first use replays the same
quote and a reused reference with any different term is refused (23505). One live and one pending quote per supplier × port ×
product. Approving a quote supersedes the previous live one **when the new one
takes effect** (`greatest(now, valid_from)`), so a future-dated price never
leaves a gap; withdrawing an approved quote before it starts restores the price
it was to replace (a supersession in the past stays immutable). A quote whose
validity has lapsed cannot be approved. A price counts (index and ticker) only
while its supplier still serves the port: removing a port takes its prices out
at once (`20261003109000`).

## Rules

- **Freshness** by quote age, counted from when the price takes effect
  (`greatest(submitted_at, valid_from)`): ≤ 7 d current, 8–14 d stale (flat arrow, "·Nd"),
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
  **Members cannot choose the moment or an arbitrary stem** (109000): for a
  member the RPC answers as of now and at the nearest standard stem (100, 250,
  500, 1,000, 2,000, 3,000, 5,000, 10,000 MT); `asOf` and `stemMt` in the answer
  are the ones used. Admins and the service role keep both parameters. The
  logic lives in the service-only `fn_bunker_fuel_index(…, p_full)`. Note: the
  ticker shows each sponsor's own prices by design (their paid exposure), so the
  3-supplier rule protects the index statistics, not sponsor prices.
- **Ticker** (`get_bunker_ticker()`): enabled, non-platform sponsors; only quotes
  valid now (`valid_from ≤ now ≤ valid_until`), judged per product; one row per
  sponsor × port with their own prices and direction against the previous
  once-live quote; no ids or contacts. The strip distinguishes "no current offer"
  from "temporarily unavailable", pauses on hover/focus, keeps a single
  focusable copy and is static under reduced motion.
- **Snapshot** (`getFuelIndexSnapshot`, frozen B→S contract C2O-033, ruling
  O2B-007): `kind: "fuel_index"`. `status` describes provenance: `trusted`
  whenever the index answered for **at least one** requested product, so live
  products are in `products` and every requested key without a live cohort is in
  `noOffer` with a "no current offer for X" warning (`noOffer.length > 0` is the
  partial signal). `unavailable`, with no products, only when no requested
  product is live or the index is not deployed, malformed or failing. Never a
  fallback of its own: the Voyage engine prices `noOffer` keys from its admin
  fallback and labels them `fallback`. A UI must therefore not show "Live" for a
  trusted-but-partial snapshot: Live only when every product is live, Partial for
  trusted with `noOffer`, Fallback/Unavailable otherwise (`loadFuelPrices().live`
  gives the per-product truth). `canonicalSha256` is the SHA-256 of sorted-key
  JSON, byte-compatible with Stream S `sealSnapshot`.
- **Supplier writes** (`supplier_upsert_quotes`, `supplier_withdraw_quote`,
  `supplier_list_my_quotes`): actor from the session; editor of an enabled
  supplier; registered port; 0 < price < 10 000; validity starts within a day,
  ends in the future, lasts ≤ 60 days; ≤ 100 quotes per call, ≤ 500 per day;
  atomic; every quote carries a `clientRef` (unique within the batch) and
  replaying it returns the same quote; replays never count towards the daily
  limit; the supplier row is locked and its enabled status and the caller's
  editor role re-checked before anything is written. The portal resends the
  identical command when a response is lost. Verified suppliers are approved on
  submission; others wait for an admin. Suppliers cannot approve, nor change
  ports or members. Withdrawing a live quote keeps it as the previous price
  for the ticker's direction.
- **Admin** (`admin_bunker_*`, service role + `p_actor`, re-checked: active admin,
  super tier or `admin_perms.bunker`): suppliers and ports, member links,
  overrides (or staff input under the platform supplier, approved at once, reason
  required), approve/reject/withdraw, `admin_bunker_dashboard`.

## Known limits (C2O-049 P2)

- **Historical `as_of` uses today's served ports.** The index and the ticker
  join the current `bunker_supplier_ports`; a port removed later also
  disappears from a past `as_of`. Port-membership history is not kept.
- **Scheduled chains approved before 110000.** 110000 records every supersession
  an approval makes in `bunker_quote_supersessions`, and cancelling an unstarted
  approval restores exactly those rows. A chain scheduled under 109000 (before
  the ledger existed) has no ledger rows: cancelling its unstarted replacement
  does not restore the previous price; republish it instead. Production never
  ran 109000 without 110000, so this affects only local and staging data from
  5–6 Oct 2026.
- **Live and scheduled together (111000).** A key holds the price live now and
  **at most one** scheduled replacement: approving a newer future price withdraws
  the older unstarted one ("replaced by a newer scheduled price") and the live
  price is re-scheduled to end at the new start. The headline "Live quotes"
  counts only prices live now. The supplier portal shows both, with "Withdraw" for the
  live (or pending) price and "Cancel scheduled" for the replacement; the console
  lists them under "Live prices" and "Scheduled to go live".

## Pilot suppliers (owner ruling, 4 Oct 2026)

`20261003108000` registers **O Bunker**, **Bahri Bunker** and **التعاون للبترول**
with placeholder details: contact "PLACEHOLDER — replace…", emails at
`example.invalid`, sample Egyptian ports (Port Said, Sokhna, Alexandria,
Damietta), unverified, no prices, no member accounts. They are invisible to
members until they publish. To replace them with real data, as an admin with
bunker edit rights:

1. `/admin/bunker` → **Suppliers & access**. The amber card lists the pilots
   still on sample data, and each carries a *Placeholder details* badge.
2. Open a supplier and edit the name, website, country, ports (LOCODEs, `*` =
   primary), contact name/email/phone (private) and trust score; clear the
   notes; **Save supplier**. The badge disappears once the notes no longer start
   with `PILOT PLACEHOLDER` and the email is real.
3. Have the supplier's contact sign up, then link the account under **Member
   email → Editor (publishes prices)**.
4. Tick **Verified** only for a first-hand physical supplier (its quotes go live
   without approval); otherwise each price waits in *Awaiting approval*.
5. Send the contact the link `/dashboard/bunker-supplier`.

A supplier not in the pilot list is added with **Add a supplier** at the bottom
of the same tab.

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
node --import tsx scripts/bunker-check.ts                       # 70 pure + SDK + snapshot + retry + Stream S parity assertions
node --import tsx scripts/bunker-sql-suite.ts | docker exec -i supabase_db_arab-ship-broker \
  psql -U postgres -d <db> -v ON_ERROR_STOP=1 -q                  # rolled-back SQL suite, same fixtures
HARNESS_PSQL="docker exec -i supabase_db_arab-ship-broker psql -U postgres -d asb_bunker" \
  bash scripts/migration-harness.sh --chain supabase/migrations/2026100310*.sql supabase/migrations/2026100311*.sql \
  --smokes <generated suite file> --downs supabase/rollback/20261003_bunker_down.sql
bash scripts/bunker-race.sh asb_bunker                           # idempotency + disable-vs-submit races (isolated DB only)
E2E_BASE_URL=http://127.0.0.1:3102 npx playwright test --config=playwright.bunker.config.ts
```
