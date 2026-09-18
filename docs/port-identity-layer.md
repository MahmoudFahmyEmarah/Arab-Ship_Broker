# Port identity layer

Built 10 Sep 2026. Ports anchor every distance, Voy OPEX, Ports DA and fixture,
so a listing whose port fields cannot be identified is commercially inert. This
note records what was wrong, what was built, and how to operate it.

## The problem, measured

Of 1,833 cargo listings, **171 (9.3 %) could not be routed** — no LOCODE on at
least one side. The 9.3 % understated it badly, because the clean rows were the
seeded workbook and every new intake month leaked:

| Created | Rows | Port gap |
|---|---|---|
| May 2026 | 339 | 0 |
| Jun 2026 | 1,057 | 0 |
| Jul 2026 | 160 | 26 |
| Aug 2026 | 57 | 38 (67 %) |
| Sep 2026 | 220 | 107 (49 %) |

**107 of the 220 cargos posted in the last 7 days could feed no calculator.**

By intake path (rows created since 1 Jul): workbook upload 114/267 (43 %),
e-mail circulars 38/57 (67 %), posting form / ledger 19/113 (17 %). The posting
form scored best because `lib/schemas/cargo.ts` hard-requires both LOCODEs. The
sync pipeline had no equivalent requirement — two doors, two standards.

Sorting the 200 missing side-entries by what they actually were:

| | Entries | Nature |
|---|---|---|
| A | 4 | `Ashtabula`, `Dalian`, `Dandong`, `NEA PERAMOS` — the resolver already returned a code. Pure defect. |
| B | 1 | `San Lorenzo (Argentina)` — resolvable once the bracket is stripped. |
| C | 15 | Option lists (`Reni or Izmail`). Each option a real port. |
| D | 180 | Genuine areas (`Egypt Med` ×28, `Greece` ×23, `Marmara` ×19 …). |

**88 % was legitimate broker language, not corrupt data.** Any rule demanding
two LOCODEs would have rejected two-thirds of the circular intake. That shaped
the whole design: force a *decision*, not a port.

## Four root causes

1. **`fn_cl_port_autofill` was one-directional** — LOCODE → name only. A
   name-only row stayed name-only forever, even when `fn_resolve_port_locode`
   had the answer. Resolution ran only at workbook staging, so anything
   arriving another way, or any port added to the master later, was never
   retried.
2. **Nothing blocked.** Across the whole rule set exactly one rule blocked
   anything — DQ-V04, `forms` only. DQ-C05 carried severity `error` but was
   `warn` on `sync` and `pipeline`, and tested only the **load** side, so all
   159 discharge gaps were invisible to it.
3. **The legitimate shapes had no home.** `load_ports`/`disch_ports` jsonb was
   used on 1 row; option-list text was dumped in `port_1_name`; and **25 rows
   had no primary discharge LOCODE while a good one sat in
   `disch_port_2_locode`**, invisible to the map and the calculators.
4. **Thin master data, duplicated aliases.** 297 active ports,
   `unlocode_registry` empty (0 rows, never imported), and port aliases
   hardcoded in *two* drifting places: a `CASE` list inside
   `fn_resolve_port_locode` and `SHORTHAND` in `lib/sync/ports.ts`.

## What was built

Migrations `20260910100000` (layer), `20260910110000` (fixes),
`20260910120000` (gate + queue).

### One reading of a port field

`fn_resolve_port_side(code, name)` classifies every port field and is the single
truth used by the trigger, the gate and the UI:

| scope | meaning | feeds calculators |
|---|---|---|
| `port` | one known port; the LOCODE is authoritative | yes, exact |
| `options` | a list where ≥ 1 option is a port | yes, from the first — **estimate** |
| `area` | a known area / country / range | yes, from its reference port — **estimate** |
| `none` | free text we cannot place | no — **this is the only defect** |

Supporting functions: `fn_port_key` (mirrors `portKey()` in TypeScript),
`fn_port_strip_notation` (removes `1sp`, `2sb(s) out of`, brackets, trailing
`rge`), `fn_port_options` (splits `or` / `and` / `,` / `/`).

### Two dictionaries

- **`port_aliases`** — broker shorthand → one real port. Replaces both
  hardcoded lists; `lib/sync/ports.ts` now loads it so the layers cannot drift.
- **`port_areas`** — `area_key`, `kind` (country/area/range), `zone`,
  **`ref_locode`** (the nominated reference port), `candidate_locodes`,
  `alias_keys`. Seeded with 40 areas covering every non-port name the live data
  uses, e.g. Egypt Med → Alexandria, Marmara → Izmit, Spain Med → Tarragona.

### The listing carries its own answer

`cargo_listings` gained `load_port_scope`, `disch_port_scope`,
`load_ref_locode`, `disch_ref_locode`. `fn_cl_port_autofill` now resolves
**both** directions on every insert and update, fills a resolvable name's
LOCODE, records the scope and reference port, and falls back to a LOCODE
sitting in slot 2. The portal reads these stored values
(`CargoView.portScope` → `legInfo(..., stored)`), so the map, Voy OPEX and
Ports DA all use one server-computed answer instead of three re-derivations.

### The gate

| Rule | Fires when | Modes |
|---|---|---|
| **DQ-P03** | a port side is unclassified free text | **block** on sync, pipeline, forms, review, api |
| DQ-P04 | a known area / list has no reference port | warn (error severity in reports) |
| DQ-R05 | an area resolves to a reference port | info — counts how much of the market is estimated |
| DQ-C05 | live cargo not routable on **either** side (extended) | warn on sync/pipeline |
| DQ-P02 | a name resolves but the code is missing | warn — the trigger self-heals it |

An area commits normally. Only text nobody can place is refused.

### The queue

`port_review_queue` + `fn_port_review_sweep()` (scans live listings **and
uncommitted staged rows**) + `resolve_port_review()`. Surfaced as **Data Sync →
Manual Review → Ports**: each name offers two ways out — *it is one port*
(saves an alias) or *it is an area* (saves the area with a nominated reference
port) — then re-classifies every listing that used the text. The nightly cron
sweeps so the queue is current even when the audit run is off.

## Result

| | Before | After |
|---|---|---|
| Both sides a real LOCODE | 1,662 | 1,666 |
| Routable (own port or reference port) | 1,662 | **1,832 / 1,833** |
| Unclassified sides | 200 | **0** |
| Last 7 days routable | 113 / 220 | **220 / 220** |

The one remaining unroutable listing names an area with no port in the registry
(Israel / Ghana). It is visible as DQ-P04.

## Operating it

- **Blocked on sync?** Data Sync → Manual Review → **Ports**. Place the name.
- **An area estimating from the wrong port?** Change `ref_locode` on the
  `port_areas` row (Database Preview, or the Ports tab).
- **DQ-P04 open?** That area has no reference port — nominate one.
- Every figure derived from a reference port is labelled an estimate in the UI
  (`RouteLeg.estimated`, the `est.` route label, the deal-card note).

## Follow-ups

### Done 10 Sep 2026 (migration `20260910130000`)

- **19 active ports had no coordinates** — Abu Zenima, Apapa, Arzew, Ashtabula,
  Dalian, Dandong, Genoa, Ghent, Lianyungang, Medgidia, Motril, Mtwara, Nea
  Peramos, Nordhorn, Onne, Orlivka, Paranagua, Rijeka, Suez. A port without
  coordinates draws **nothing** — not a stored route, not a corridor estimate,
  not even the fallback arc. Filled with approximate port positions, each
  marked in `ports.notes` so the UN/LOCODE import overwrites them. Live
  listings with both ends plottable went from 1,613 to **1,631 of 1,632**, and
  all 39 areas with a nominated reference port now have a plottable one.
- **Vysotsk (`RUVYS`) and Tallinn (`EETLL`) added**, with aliases for the
  circular spellings "Vyotsk" and "Vene Balti". The ports review queue is
  empty. Zone note: the registry files Baltic ports under `NCONT` (Gdansk,
  Gdynia, Szczecin, Klaipeda all are), so these follow that convention.
- **`port_routes` can now hold a directional track.** `direction_specific`
  splits the unique index: one symmetric row per `pair_key`, plus an optional
  row unique on the ordered `(pol, pod)`. `get_port_route` prefers an exact
  directional match and falls back to the symmetric row reversed.

#### On reversal — checked, and clean

`get_port_route` has served the reverse of a stored track since commit
`420ee99`, and `routeGeometry.ts` since `bfe9fc1`; neither was written as part
of this work. **48 % of live route lookups (294 of 611) are answered by
reversal**, so it matters. It was audited against the source master:

- The 423 ECDIS source files contain **zero reciprocal pairs** — all 420
  distinct pairs were surveyed in exactly one direction, so no directional
  data was ever lost at import.
- The one apparent duplicate (`LYBGN to TRISK.csv` / `LYBGN toTRISK.csv`)
  differs only in a route-name comment; the waypoints are identical.
- Reversal re-bases cumulative distance, it does not merely flip the list:
  Port Said → Sfax reads 0 → 1,131 NM, Sfax → Port Said reads 1 → 1,132 NM,
  same 1,132 NM total.

`get_port_route` now returns `reversed`, `direction_specific` and
`surveyed_as` (e.g. `"EGPSD → TNSFA"`), surfaced on `MeasuredRoute` in
`sdk/app/routes.ts`. **The UI does not currently label a reversed route
differently**, deliberately: the geometry is the surveyed track either way, and
flagging half the market as an "estimate" would be misleading. The data is
there if a tooltip should ever say which way it was surveyed.

### Still open

- **Import the UN/LOCODE registry** — `unlocode_registry` is still empty. The
  single biggest lever on resolution: 299 known ports today vs ~110k codes, and
  it replaces the 21 hand-entered coordinate sets with authoritative ones. The
  importer exists (`lib/dq/registry.ts`, `/api/dq/registry`); it needs the CSV.
- **17 live pairs have no stored route** in either direction — every one
  involves a port with zero ECDIS coverage. They now fall to the curated
  sea-graph corridor (water-only, follows the real chokepoints) rather than
  drawing nothing. Chaining A→B→C was considered and rejected: at 97.3 %
  coverage it would serve a handful of pairs and can be badly wrong when the
  intermediate port is a detour.
- `vessel_availability.open_port_*` has the same shape of gap (DQ-A01, 53 open
  issues). `fn_resolve_port_side` is table-agnostic, so extending the trigger
  to positions is small.
- 25 legacy LOCODEs contain a space (`RU NOI`, `EG PSD`). All are already
  inactive and no listing references them — harmless, but they should be
  deleted once the registry import lands.
- `ESROT` / `TRROT` are both "Rota" — legitimately two ports, but worth a
  disambiguating trade name.

## 17 Sep 2026 — three route states, and a gate that refuses the third

The owner's screenshot (Greece → Syria, Izmail → Egypt Med) showed the card
faithfully printing an area with an AREA marker and nothing else: the
reference route lived only in a tooltip. Every cargo now carries one of three
explicit states, and the market prints the second line instead of hiding it:

| State | Main line | Second line |
|---|---|---|
| **exact** | `Izmail → Samsun` | none |
| **estimated** | `Greece [area] → Syria [area]` | `≈ Estimated via Piraeus → Lattakia` |
| **estimated** | `Izmail → Egypt Med [area]` | `≈ Estimated via Izmail → Alexandria` |
| **estimated** | `Izmail or Reni [alt] → Samsun` | `≈ Estimated via Izmail → Samsun` |
| **invalid** | `Izmail → Israel [area]` | `! Reference port required` (amber) |

`routeState()` / `routeEstimate()` in `lib/portal/route-legs.ts`;
`components/portal/RouteEstimate.tsx` renders the line on the cargo card and
the dashboard row. The per-side markers stay (they say *which* side is the
area); the reference port never replaces the listing's wording, so nobody
reads Piraeus as the contractual port. `scripts/route-legs-check.ts` pins it.

### The publication gate (`20260917120000_cargo_live_route_gate.sql`)

Audit of the live database on 17 Sep: **1,632** approved live cargo =
**1,473 exact + 158 estimated + 1 invalid** (EM-5C764B40, Izmail → "Israel":
the area has no reference port and the registry has no Israeli port). The
three screenshot areas are mapped and live (Greece → GRPIR Piraeus, Syria →
SYLTK Lattakia, Egypt Med → EGALY Alexandria).

- `trg_cl_zy_live_route_gate` — BEFORE INSERT/UPDATE on `cargo_listings`. A
  row becoming live + approved (or a live row whose port sides change) must
  resolve to a LOCODE on both sides: own code, the area's reference port, or
  slot 2 (`fn_cl_effective_locode`). Otherwise the write is refused with a
  `ROUTE_GATE:` message that the posting forms show as plain text. It sits
  under every ingestion path — forms, the v1/v2 RPCs, sync, the circular
  pipeline, Manual Review, the review-queue approval trigger, admin edits.
  A row that is already live can still be closed or re-priced.
- `20260917130000_cargo_live_routable_ck.sql` — the same rule as a CHECK
  constraint, the backstop if the trigger is ever disabled. It refuses to
  apply while any live row is unroutable and names the rows (a NOT VALID
  check would still fire on every edit of such a row). Close or place
  EM-5C764B40 first, then push again.
- `cargo_listings_load_ref_locode_fkey` / `_disch_ref_locode_fkey` — the
  reference columns now point at `ports` like the primary and slot-2 columns,
  so "effective LOCODE" means a real port. Audit 17 Sep: 0 dangling
  references in 1,833 rows; the keys are validated in the migration.
- `trg_*_zz_dq_gate` on `cargo_listings`, `vessel_availability`, `vessels` —
  the central `fn_dq_validate` gate on the **member forms**, evaluated on every
  authenticated write (channel `forms`, or whatever a route puts in the
  `dq.channel` setting — a future partner API sets `api`). **Shadow by
  default**: blocks are logged to `dq_gate_log` (Data quality → Gate → log),
  nothing is refused. Switch on with Data quality → Settings → *Enforce on
  member forms* (`dq_settings.gate_forms_enforce`); then the gate **fails
  closed** — if it cannot evaluate, or any single rule fails to evaluate
  (the `errors` counter), the write is refused. Administrators' own sessions
  (review-queue approval, admin edits) are skipped: they are gated on their
  own channel and never judged again as a form. Known limit: an enforced
  refusal rolls back its own `dq_gate_log` entry with the transaction; shadow
  logs persist. Review the forms column of the matrix first: every
  error-severity rule blocks there by default.
- Review-queue approval (`approveQueueItem`) runs `validateRow(..., { strict:
  true })` on the review channel before approving a cargo: a block refuses,
  and so does a gate that cannot run or a rule that fails to evaluate.
- A stored side with scope `none` and a reference (a LOCODE found in slot 2)
  is shown as an **area**, never as alternatives.

Apply: reconcile the migration history first (`supabase migration list`,
then `supabase migration repair`), `supabase db push --dry-run`, then push.
The first migration prints a NOTICE with the live rows that predate the gate;
the second refuses until they are closed or placed.
