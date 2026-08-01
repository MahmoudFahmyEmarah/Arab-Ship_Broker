# Arab ShipBroker, Post Position and Post Cargo, CTO Handoff

Prepared for engineering integration. This package is the single source of truth for the
rebuilt **Post Position** (list a vessel / open position) and **Post Cargo** (add a cargo)
flows, plus the backend Q88 vessel model and the company registry that back them.

---

## 0. BRANCHING POLICY, READ FIRST

**Commit everything to ONE place: the `main` branch.**

- Do not spin up a new branch after new branch. Branch-after-branch causes work to get lost
  and become hard to reconcile when we bring it all together.
- Land each change set on `main` (or merge promptly), keep a single integrated source of
  truth, and avoid parallel divergent branches.
- One integrated tree. If you must branch for review, merge it back to `main` the same day.

---

## 1. What this is

Two guided, collapsing-step forms built as standalone HTML (no build step, React + Babel via
CDN). They render inside the ASB Design System scope (`class="asb-ds"`).

- **Post Position** (`Post Position (rebuild).html`), 6 steps: Vessel, Cargo Arrangement,
  Availability, Performance & Gear, Commercials, Review & Submit.
- **Post Cargo** (`Post Cargo (rebuild).html`), steps: Commodity, Quantity, Load & Discharge
  (rate mechanism), Terms, Review.

Design philosophy agreed with the business:

> The backend/database models every ship to the FULL Q88 (Baltic 99) structure. The frontend
> collects only the **minimum valuable data** a broker can give in a couple of minutes; the
> platform then enriches the rest from Q88 import, the registry, or Bosun AI. This is a
> deliberate "smart platform" stance: user gives little, system resolves the rest and controls
> data quality.

---

## 2. How to run

**Quickest (no setup):** open `standalone/Post Position (standalone).html` or
`standalone/Post Cargo (standalone).html`, fully self-contained single files that work by
double-click from anywhere, including file://.

**Source pages:** the root `.html` files load their `.jsx` modules at runtime, which browsers
block on the file:// protocol. Serve the folder over HTTP instead, e.g.
`python -m http.server` (or `npx serve`) from the package root, then open
`http://localhost:8000/Post%20Position%20(rebuild).html`. Scripts load in this
order (see the HTML `<head>`/`<body>`):

1. React 18.3.1 + ReactDOM + Babel standalone (pinned, with integrity hashes, keep them).
2. `asb/pp2-data.js` (enums, ports, fleet registry, size gate).
3. `asb/vessel-schema-q88.js` (backend vessel contract, `window.PP2Schema`).
4. `asb/companies-data.js` (Post Position only, `window.PP2Companies`).
5. `asb/pc2-data.js` (Post Cargo only, commodity dictionary).
6. `_ds/.../_ds_bundle.js` (ASB Design System components: Button, Input, Icon, StatusBadge,
   SegmentedToggle, etc.).
7. `asb/pp2-steps.jsx` + `asb/post-position2.jsx` (Post Position), or
   `asb/pc2-steps.jsx` + `asb/post-cargo2.jsx` (Post Cargo).

CSS: `asb/ds-scoped.css` (scoped DS tokens, lighter ramp) + `asb/pp2.css` (shared page chrome,
used by BOTH pages).

---

## 3. File inventory

| File | Role |
|------|------|
| `Post Position (rebuild).html` | Post Position host page |
| `Post Cargo (rebuild).html` | Post Cargo host page |
| `asb/post-position2.jsx` | Post Position app shell (accordion, header, Bosun FAB, submit gate) |
| `asb/pp2-steps.jsx` | Post Position step bodies + shared field primitives (Field, SelectTip, VesselCard, ownership block, company picker) |
| `asb/pp2-data.js` | Enums, ports, demo fleet registry, `SIZE_GATE_DWT` |
| `asb/vessel-schema-q88.js` | **Backend vessel model**, Q88/Baltic 99 canonical sections, `window.PP2Schema` |
| `asb/companies-data.js` | Company registry (03_COMPANIES, 88 firms), `window.PP2Companies` |
| `asb/post-cargo2.jsx` | Post Cargo app shell |
| `asb/pc2-steps.jsx` | Post Cargo step bodies, commodity classification readout, tier store/`DemoTierSwitch` |
| `asb/pc2-data.js` | Commodity dictionary (source of truth, see section 6) |
| `asb/pp2.css` | Shared page CSS (both pages) |
| `asb/ds-scoped.css` | Scoped DS tokens |
| `_ds/asb-design-system-.../` | ASB Design System bundle |

---

## 4. Backend vessel model, Q88 (the important part)

`asb/vessel-schema-q88.js` is the **database contract**. Every ship conforms to this same
structure; all fields are nullable. Exposed as `window.PP2Schema`.

Key points for engineering:

- **Canonical vs legacy.** Each field carries a Q88 canonical `key` + Q88 `label`, and a
  `legacy` mapping to the current registry/frontend key, so existing records keep working while
  the DB migrates to canonical column names. Migrate columns to canonical names; keep the
  `legacy` map only as a read-shim during transition, then drop it.
- **Sections** mirror the Q88 Long Form: Identity & registration, **Ownership & operation
  chain**, Dimensions & tonnage, Cargo arrangement, **Per-hold detail**, Gear, Performance,
  Class & inspections, etc.
- **Ownership chain** (added this cycle): Registered owner, Parent company / group, Technical
  operator, Commercial operator / Manager, Disponent owner. Five-tier Q88 style.
- **Per-hold detail** (added this cycle), repeats for hold index 1..9:
  grain capacity, bale capacity, tanktop suitable for grab discharge, CO2 fitted,
  smoke detection, hoppered (side / forward / aft), grain-fit per SOLAS ch. VI, A60 steel
  bulkhead.
- **Hard caps** (enforce in DB constraints and API validation):
  - Maximum holds = **9**
  - Maximum cranes / derricks = **4**
  - Maximum grabs = **5**
- **"verified"** flips true when the Q88 is complete; until then a ship is a partial record the
  platform keeps enriching.

The frontend Vessel/Arrangement/Gear/Performance steps write only the **minimum capture
subset** of this schema. Do not force users through the full Q88 in the normal flow, that is a
multi-hour form; it is populated by Q88 import / Bosun AI / registry instead.

---

## 5. Company registry & ownership picker

`asb/companies-data.js`, from workbook sheet **03_COMPANIES** (88 firms), `window.PP2Companies`.

- Each firm: name, IMO, country, counts (owns / commercially manages / ISM manages / fleet
  total), address, and inter-company link fields (`linkedToImo`, `linkNote`, `linkType`).
- **Links are firm-to-firm** (parent / affiliate by company IMO), not firm-to-vessel. Vessels
  resolve to firms by name.
- In the Vessel step, an **Ownership & management** strip sits inside the vessel card,
  collapsed by default. Expanding shows the five-tier chain with a searchable company picker
  (split-screen: search left, profile right).
- **Tier gating:** viewing a full company profile is **Tier 3 / Tier 4 only**. Tiers 1 / 2 see
  a locked teaser. Enforce this server-side too, do not rely on the client gate.

---

## 6. Commodity classification, source of truth

`asb/pc2-data.js`. The ONLY valid sources of truth, everything wires around these:

- **Break bulk**, from sheet **08_CLASS_CSS** only.
- **Dry bulk**, two parts:
  - **Grain**, from sheet **06_CLASS_GRAIN**.
  - **Solid Bulk Cargoes ("other than grain")**, from sheet **07_CLASS_IMSBC**.
- Between the official name and the user sits a **Market Name** layer. If a commodity has no
  market name yet, show the official name unchanged until the DB is updated with one. Do not
  fabricate market names.

**Smart commodity search (Tier 3 / 4 only):** split panel, searchable list left, live
classification readout right, cargo form, dry-bulk vs break-bulk, grain vs solid-bulk (IMSBC),
UN number (if any), DG yes/no, MHB yes/no, liquefaction flag. Reads the pre-set classification
DB. Tiers 1 / 2 get the standard picker (no smart readout). Again, enforce the gate server-side.

---

## 7. Business logic & rules

- **Size / niche gate:** `SIZE_GATE_DWT = 66,000` DWT. Over the gate raises a soft inline
  note (Arab ShipBroker focuses on sub-66k niche tonnage). It is a **soft** warning, not a hard
  block; matching-side checks stay soft too.
- **Vessel type:** only **Bulk Carrier** and **General Cargo**. Special designs (Geared Bulk
  Carrier, Multi Purpose, Open Hatch) moved to a **Vessel Configuration** dropdown in step 2
  (Cargo Arrangement); optional, blank = standard.
- **Availability:** "Open from" only ("Open to" removed). STATUS enum
  (Open / Fixed / On Subs / Ballast / Off-hire) plus WOG as a separate toggle. Charter type
  present with a quiet disponent-verification note (no user-facing banner).
- **Volume / quantity (Post Cargo):** required, user-editable, with unit toggle per the
  validation matrix.
- **Fuel model:** lean spec (fuel type, ME sea, ME port, AUX port, BROB, speed) + Scrubber and
  ECA toggles.
- **Trading zones:** rendered from the DB trading-zone list.
- **Tooltips:** every field label carries a plain "!" hint (no box). Dropdowns use an
  interactive flyout, hover an option to see its definition. Definition maps live at the top of
  `pp2-steps.jsx` / `pc2-steps.jsx` (VTYPE_DEFS, CONFIG_DEFS, DAY_DEFS, rate/exception defs,
  etc.). Business owns the wording; a few abbreviations are still pending sign-off.
- **Bosun AI (Post Position) / Foreman AI (Post Cargo):** corner FAB that opens an assistant
  panel; paste a circular or upload a Q88 to extract and apply fields. **The extractor is a
  mock** for the prototype, wire it to the real parsing service.

---

## 8. Tier plumbing (demo vs production)

- Standalone pages use a shared demo store: `window.__ASBTierStore` / `window.__ASB_TIER__`,
  with an on-screen `DemoTierSwitch` (T1..T4) for demonstration.
- **Remove `DemoTierSwitch` and the demo store in production.** In the portal, read the viewer
  tier from the real context (`window.ASBTierContext` / `window.useViewerTier`) and the plan
  info in `subscription-checkout.jsx` (`window.ASB_TIER_INFO`, `window.asbTierIsPremium`).
- Tier names in use: T1 Free, T2 Registered/Standard, T3 Subscriber, T4 Broker/Partner
  (naming to be finalised, treat T3/T4 as "premium").

---

## 9. REMOVE OLD CODE (action required)

These rebuilds **supersede** the earlier Post Position / Post Cargo implementations. Before or
during integration, confirm nothing else imports them and then delete the legacy files so there
is no dead or conflicting code:

- `asb/post-position.jsx` (old Post Position)
- `asb/post-cargo.jsx`, `asb/post-cargo.css` (old Post Cargo)
- `asb/post-collapse.jsx`, `asb/post-collapse.css` (old collapse experiment)
- `asb/post-forms.css` (old shared form CSS)
- any `*.locked-v1.*` snapshot (design freeze, reference only, not for integration, already
  excluded from this package)

Steps: grep the codebase for references to each file and to the old component exports, migrate
any remaining callers to the rebuild pages, delete the legacy files, and verify the app builds
and both flows render. Do not leave the old and new versions side by side.

---

## 10. Data sources

- `ArabShipBroker_UNIFIED_CargoMap_14Jul2026.xlsx` is the current source of truth (supersedes
  `..._MASTER_Cargo_Classification_Map_v2`). Sheets used: 02_VESSELS, 03_COMPANIES, 04_PORTS,
  06_CLASS_GRAIN, 07_CLASS_IMSBC, 08_CLASS_CSS, 10_ENUMS.
- Q88 reference: `Alfred Oldendorff, Q88Dry_LongForm.xlsx` (Baltic 99 Long Form, ~1,000 fields),
  used to shape `vessel-schema-q88.js`.
- If you find discrepancies between the two cargo maps, treat the UNIFIED file as authoritative
  and flag the difference back to the business.

---

## 11. Open items / follow-ups

- Wire the Bosun / Foreman Q88 extractor to the real parsing service (currently mocked).
- Finalise tier names and enforce all tier gates server-side.
- Populate Market Name coverage in the DB; until then official names show through.
- Confirm and remove the legacy files in section 9.
- A handful of tooltip abbreviations await business sign-off.
