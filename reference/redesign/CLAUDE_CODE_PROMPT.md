# Claude Code — apply Arab ShipBroker “Post Cargo + Org model” changes

You are updating the **real Arab ShipBroker codebase** (Next.js + Supabase). This
folder contains the **approved design prototype** (plain-React/Babel files that run
inside `Portal.html`). Treat the prototype as the **source of truth for behaviour,
copy, layout and data shapes**, and port each change into the production app’s
own components/styles. Do **not** copy the Babel/`window.*` global pattern into
production — translate it into the app’s real React components, hooks and CSS.

Reference files in this bundle:

| File | What it is |
|---|---|
| `asb/post-cargo.jsx` | The full Post Cargo wizard (the main change) |
| `asb/post-cargo.css` | Wizard styles incl. the v4/v6 “bigger type + fit-to-window” overrides |
| `asb/ports-data.js` | UN/LOCODE seaport reference + `findPorts` / `portMeta` helpers |
| `asb/companies-data.js` | Organization (company) directory + org-model helpers |
| `asb/detail-panel.jsx` | Cargo/Vessel detail panels (org-model “Posted by” / Ownership) |
| `asb/loader-overlay.js` | Drop-in propeller page-transition loader |
| `Portal.html` | Shows the script wiring + the SPA hash deep-link change |

---

## 1. Post Cargo wizard — 5 steps, single cargo

Steps, in order: **Cargo & Qty → Ports → Laycan & Terms → Safety → Review**.

- **Quantity moved into Step 1** (“Cargo & Quantity”): min/max MT, auto volume in
  **CBM** derived from the stowage factor, and the **MOL** control (% + MOLOO/MOLCHOPT).
- **Step 2 is Ports only** (POL/POD, up to 4 each, call status chips).
- **Single cargo** — remove the multi-parcel feature entirely (no “Parcels” card,
  no `parcels[]` state, no extra-parcel rows).
- Stepper labels, “Edit ←” deep links, and the Review summary must match the
  new step order.

## 2. Ports — auto-load LOCODE + zone

Typing a **port name or LOCODE** searches the UN/LOCODE reference and, on pick,
**auto-fills LOCODE, country and zone** (read-only, shown in a derived grid with
the caption “LOCODE & zone loaded automatically from the UN/LOCODE reference”).

- Data: `asb/ports-data.js` is generated from the attached `upply-seaports.csv`
  (≈14,300 ports). It exposes `ASB_findPorts(query, limit)` and `ASB_portMeta(p)`
  returning `{ name, locode, country, zoneCode, zone, shortZone }`.
- In production: back this with a **ports table** (or the existing port master)
  and a typeahead endpoint; keep the same field shape. The platform’s short zone
  codes (B.SEA, E.MED, W.MED, R.SEA, AG, A.SEA, CONT, F.EAST, E.AFR, W.AFR,
  S.AFR, N.AMER, S.AMER, OCE) are what listings store; the CSV’s raw zone codes
  are mapped to those.
- The Suez-route flag in Step 2 keys off the **zone code** of the two primary ports.

## 3. Stowage Factor — standard unit m³/t

- **m³/t is the default/standard unit**; ft³/t is a secondary toggle.
- Platform default (from the commodity master, stored as ft³/t) is **displayed in
  m³/t** (`ft³ ÷ 35.87`). Input accepts either unit and auto-converts; Review shows
  `X.XX m³/t · NN ft³/t`.

## 4. Break-bulk packing — per the CSS_BreakBulk reference

When form = **Break-Bulk**, “packing” is chosen from the **12 official CSS Code
categories** (CSS-01…CSS-12), each carrying its **securing-verification trigger**
and **market aliases** (see `CSS_BREAKBULK` in `post-cargo.jsx`, taken verbatim
from the `ArabShipBroker_CSS_BreakBulk.xlsx` sheet). Bulk cargo keeps simple
packaging (Bulk / Bagged / Big Bags). The commodity master’s `css` value maps to
one of the 12 labels (e.g. Steel Coils → “Coiled sheet steel” = CSS-06).

## 5. Fit-to-window layout

Each step should **fit one viewport with no vertical scroll where possible**
(Review, being a full summary, may scroll). Achieved via: legible 12–14px type,
dense card rhythm, slimmer header/stepper/footer, full-width grid so cards sit
side-by-side (Step 1’s Form & Nature + Quantity share one row). See the **v4** and
**v6** override blocks at the bottom of `post-cargo.css`.

## 6. Organization (company) model

Ownership, subscription tier and the **marketplace contact channel** live on the
**company**, not the person. One company per person; a company has many people.

- **Data shape** — see `asb/companies-data.js`. Each org:
  `{ id, name, type(owner|charterer|broker|operator|manager|other), country, tier,
     imo?, fleetTotal?, address, desk:{name,email,phone}, members:[{name,role,current?}] }`.
  Helpers: `ASB_activeOrg()`, `ASB_currentMember()`, `ASB_cargoOrg(cargo) →
  {org,handler}`, `ASB_vesselOrg(vessel) → {owner,manager}`. The owner/manager
  rows come from the real `Companies details.xlsx` registry.
- **Post Cargo header**: a “**Posting as · {company} · {type} · {tier} · You · {member}**” chip.
- **Visibility card** (Review): reworded — the listing **circulates under the
  company desk**; enquiries route to `desk.email`; no individual’s direct line shown.
- **Review “Posted by” card**: Company, Country, Subscription (org tier),
  **Handled by**, Desk contact / email / phone, with the rule: counterparties see
  the desk flagged “handled by {name}”; if the person leaves, the listing stays
  with the firm.
- **Cargo detail panel**: a “**Posted by**” section (company · desk · handled-by).
- **Vessel detail panel**: the **Ownership** section pulls a real registry company
  (owner + ship manager, IMO, fleet count, address, desk email).
- **Boards**: outsiders see the **company** only; the **handler is internal-only**
  (own desk + ASB) — do not expose the person on public cards.

Production note: in the real schema, ownership is `listing_ownership` + a new
`owner_org_id` on `organizations`; the firewall function (`fn_owns_*`) tests
membership via `fn_my_org_ids()`. The masked detail views should return the
**org desk contact** + a **handled_by** name (authorised viewers only). The
prototype’s `ASB_cargoOrg` / `ASB_vesselOrg` are **deterministic demo stubs** —
replace them with the real `owner_org_id` join once listings carry it.

## 7. Propeller loading overlay

Add `asb/loader-overlay.js` (drop-in). It injects a fixed, blurred overlay with an
animated 3-blade propeller + two hydro rings, respects `prefers-reduced-motion`
and dark mode, and:

- **Multi-page**: include the script on every page — it auto-shows on internal
  link clicks and fades out on load (`data-min-visible`, `data-auto-nav` config).
- **SPA / route change**: call `ASBLoader.show()` before a transition and
  `ASBLoader.hide()` when the new view mounts (the Portal shell shows it on every
  `page` change for ~600ms — see `Portal.html`).

In Next.js, wire `ASBLoader.show()` into `router.events` (`routeChangeStart`) and
`hide()` on `routeChangeComplete` / `routeChangeError`, or the App Router
equivalent.

## 8. SPA hash deep-linking

The shell reads `location.hash` on init to pick the initial page
(`Portal.html#post-cargo` opens Post Cargo) and `history.replaceState`s the hash on
every page change so views are linkable / refresh-safe. In Next.js this is native
routing — make sure `/post-cargo` (and the other views) are real routes.

---

## Acceptance criteria
1. Post Cargo is a 5-step single-cargo wizard with the order above; Quantity is in Step 1.
2. Port fields auto-fill LOCODE + zone from a name/LOCODE typeahead.
3. Stowage factor shows/standardises on **m³/t** (ft³/t secondary).
4. Break-bulk packing offers the **12 CSS categories** with securing notes.
5. Each input step fits one viewport without scrolling at ~900px height.
6. The org model is visible: Posting-as header, company-desk visibility, Review
   “Posted by”, cargo-detail “Posted by”, vessel-detail Ownership; handler is
   never shown to outsiders.
7. The propeller overlay shows on navigation; hash/route deep-links work.
