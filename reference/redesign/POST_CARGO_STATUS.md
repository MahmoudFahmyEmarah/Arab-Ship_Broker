# Post Cargo + Org-model redesign — implementation status

Tracks the `CLAUDE_CODE_PROMPT.md` handoff against the real codebase. The
prototype (`prototype/*`) is the source of truth for behaviour/copy/layout;
production ports it into real components — never the Babel/`window.*` pattern.

## Branch / deploy strategy
- **Phase A** (safe, self-contained) → shipped to **main**: propeller loader +
  real port coordinates from `upply-seaports.csv`.
- **Phase B** (the wizard + org model, a live-path refactor) → branch
  **`claude/post-cargo-redesign`** with its own Vercel preview, so the live
  cargo-posting form on the production domain isn't destabilised mid-build.

## Acceptance criteria — state

| # | Criterion | State | Notes |
|---|-----------|-------|-------|
| 7 | Propeller overlay on navigation | ✅ done (main) | `components/portal/PropellerLoader.tsx` + `lib/portal/loader.css`, mounted globally; shows on internal link clicks, fades on route render. Replaced the thin top-bar loader. |
| — | Real port coordinates | ✅ done (main) | `FALLBACK_PORTS` rebuilt from the UN/LOCODE reference (184/278 real lat/lon; rest centroids). |
| 1 | 5-step single-cargo wizard, **Quantity in Step 1** | ✅ done (branch) | `CargoForm` steps are now **Cargo & Quantity → Ports → Laycan & Terms → Safety → Review**. Quantity + auto-CBM volume moved into Step 0; Step 1 is Ports-only. No multi-parcel existed in the production form (already single-cargo). |
| 8 | Hash/route deep-links work | ✅ native | App Router routes already deep-link (`/dashboard/cargo/create` etc.); no hash shell needed. |
| 3 | Stowage factor standard **m³/t** | 🟡 mostly | Input + commodity default already in **m³/t**. TODO: Review line should read `X.XX m³/t · NN ft³/t` (add ft³/t = m³/t × 35.87 secondary). |
| 2 | Ports typeahead auto-fills LOCODE + zone | 🟡 partial | `PortAutocomplete` already searches + fills LOCODE/zone on pick. TODO: confirm it’s backed by the full UN/LOCODE reference (14.3k ports via a ports table / typeahead endpoint), up-to-4 POL/POD with call-status chips, and the Suez-route flag keyed on the two primary ports’ zone codes. |
| 4 | Break-bulk packing = 12 CSS categories | ⬜ pending | Add `CSS_BREAKBULK` (CSS-01…12 + securing trigger + market aliases, from `ArabShipBroker_CSS_BreakBulk.xlsx`) as the packing selector when form = Break-Bulk; bulk keeps Bulk/Bagged/Big-Bags. Commodity `css` value maps to one of the 12. Needs a `packing`/`css_category` field on the cargo write path. |
| 6 | Org model visible (Posting-as, company-desk visibility, Review “Posted by”, cargo/vessel detail Ownership; handler internal-only) | ⬜ pending (backend designed) | The `organizations` / `organization_members` / `owner_org_id` schema + firewall-via-`fn_my_org_ids()` is **designed** (see earlier migration sketch) but **not built/seeded** — no membership/desk data in prod yet. The prototype’s `ASB_cargoOrg`/`ASB_vesselOrg` are demo stubs. Build order: (a) org migrations + desk contact, (b) seed orgs/members from a people list, (c) `owner_org_id` join, (d) Posting-as header + Review “Posted by” + detail-panel “Posted by”/Ownership reading the real org. |
| 5 | Each input step fits one viewport (~900px) | 🟡 partial | Reorder helps (Form & Quantity share Step 1). TODO: port the v4/v6 dense-rhythm overrides from `prototype/post-cargo.css` (12–14px type, slimmer header/stepper/footer, side-by-side cards). |

## Done this session
- Phase A shipped to main (loader + coordinates).
- Phase B branch: **step reorder** — Quantity → Step 1, Ports-only Step 2, headers/labels/validation (`STEP_FIELDS`) updated. `tsc` + `next build` green.
- Persisted the full design handoff into `reference/redesign/` (prompt, prototype JSX/CSS/JS, the seaport CSV, the CSS break-bulk xlsx).

## Next (in priority order)
1. CSS break-bulk packing selector (4) — bounded; needs a write-path field.
2. Stowage Review `m³/t · ft³/t` line (3) — quick.
3. Ports: confirm/extend typeahead to the full reference + multi-port + Suez flag (2).
4. Org model build-out (6) — the largest remaining piece; backend-first.
5. Fit-to-window density pass (5).
