# PDA · Ports module — design-fidelity build spec

**Owner rulings.**
- B2ALL-061 (19 Oct 2026): fix the design fidelity, "polished to perfection". The member sidebar and the map style stay as in the app.
- 19 Oct, scope "everything now": build every Ports-module page. Where the platform holds no data yet, the page shows an honest "Not recorded yet" state, never sample figures (design contract: the prototype's data is not authorised).

**Reference.** `tmp/Arab ShipBroker Portal - Standalone (7).html`:
- Screenshots: `tmp/design-audit/design/p-*.png`.
- Readable sources: the session scratchpad's `jsx2/` (`da-calculator__*.jsx/js`) and `css/<page>_<n>.css`, extracted from `tmp/design-extract*/999_*`.
- CSS layers: tokens → da-plus → ds-icons → `port-details.css` (`pd-*`, shared) → page CSS → ports-responsive.

## 0 · Shared building blocks (once, `components/pda/ports-ds.css` under `.asb-ds`)

Tokens:

| Token | Value |
|---|---|
| navy | #0D2545 |
| navy-deep | #0D2240 |
| blue | #185FA5 |
| blue-light | #E6F1FB |
| gray-50 | #F5F7FA |
| gray-100 | #EDF1F6 |
| gray-200 | #DDE2EA |
| gray-400 | #B6BFCC |
| gray-500 | #8B95A3 |
| gray-700 | #4B5566 |
| faint | #9AA7BD |
| slate | #6B7A99 |
| line | #DDE5F0 |
| green | #2A9962 (bg #DEF1E2) |
| amber | #B17311 (bg #FBF2DF) |
| red | #C84A4A |
| `--bd` | 1px solid gray-200 |
| `--r-card` | 4px |

Module-local overrides:
- `--sh-card: 0 1px 2px rgba(13,37,69,.05),0 2px 8px rgba(13,37,69,.04)`
- `--grad-navy: linear-gradient(180deg,#16345F 0%,#0D2545 100%)`
- `--pf-sh: 0 1px 2px rgba(13,37,69,.05),0 4px 16px rgba(13,37,69,.05)`

**TopBar `.pd-topbar`**
- `display:flex; align-items:center; gap:10px; padding:10px 24px; border-bottom:var(--bd); background:#fff; position:sticky; top:0; z-index:5`.
- `.pd-back`: 12px, gray-700, padding 4/6, radius 5, gray-50 on hover.
- `.pd-crumbs`: 11px gray-500, with a `b` in navy 600.
- The view toggle is the right-most item.

**HeroBand `.pd-band`**
- `padding:22px 24px 20px; color:#fff; background:linear-gradient(135deg,navy,navy-deep)`.
- `__ey`: 11px / .14em / uppercase / 700 / .85.
- `__title`: 30px / 700 / 1.05 / -.01em, margin-top 4.
- `__sub`: 13px, .92, margin-top 6.
- `__badges`: flex, gap 8, margin-top 14.
- `__actions`: absolute, top 22, right 24. Buttons are `rgba(255,255,255,.16)` with a `.28` border; `.is-primary` is white on navy.

**StatChip `.pd-badge`**
- `inline-flex; gap:6px; 11px/600; padding:4px 11px; border-radius:99px; background:rgba(255,255,255,.16); color:#fff`.
- `.dot` is 7px in currentColor.

**Panel `.pd-panel`**
- White, `border:var(--bd)`, radius 10, `box-shadow:0 1px 2px rgba(13,34,64,.04)`.
- `__hd`: padding 12/16, bottom border.
- `__h`: 11px / .1em / uppercase / gray-500 / 700.
- `__body`: padding 16.

**ModuleTabs (estimator) `.pe-tabs`**
- `gap:2px; padding:0 24px; border-bottom; bg #fff`.
- `__b`: 13px/600, padding 9px 14px, 2px transparent bottom border, gray-500, gap 7, 14px icon.
- `.is-on`: navy text with a blue underline.

**Record tabs `.pp-tabs`**
- Sticky.
- `.pp-tab`: 12.5px/600, padding 10px 14px 9px; `.is-on` has a navy underline.
- `__c` count: 10px/700 faint, blue when on.
- `.is-ghost` "+ Arm n…": gray-200.

**PillTabs `.ap-tab`**
- 600 13px/1, padding 9/15, radius 99, `var(--bd)`, white.
- `.is-on`: `--grad-navy`, white.
- `__n`: 11px, blue bg, white.

**Segmented toggles**
- Navy `.pe-set-seg__b`: 11.5px, padding 5/11, 0.5px gray-200, radius 5 on the outer ends; `.is-on` navy/white.
- Light `.px-seg button`: 11px/600, padding 4/9, no border, radius 5; `.is-on` blue-light/blue.

**RecordShell** (Port Particulars and Tariff Pack): TopBar → `.pp-tabs` → `.pdr-wrap`.
- `.pdr-wrap`: grid `118px | 1fr`, gap 22, padding 20/26/60, max-width 1320. The rail shows only for 3+ sections; otherwise `.is-norail`.
- `.pdr-rail`: sticky. 22px number, 12.5px/600 title, 10.5px count.
- `.pdr-head`:
  - border, radius 12
  - `__band`: navy gradient, grid `92px | 1fr`, padding 18/20
  - `__seal`: 72px, `1px dashed rgba(255,255,255,.45)`, radius 8
  - `__title`: 25px/600; a placeholder is an `em` at .42
  - `__meta`: auto-fit 140px cells; `.k` 10px / .09em / 700 gray-500; `.v` 12.5px/600; an empty `.v` is gray-200
- `.pdr-access`: radius 8, padding 11/14, `0.5px line`.
- `.pp-arm__tag`: 9.5px/700 blue-light; `.is-shared` gray-100.
- `.pdr-ctl`: `.pdr-tgl` pills (11.5px/600, radius 99, padding 5/12, 7px dot; `.is-on` blue) and the legend.
- `.pdr-sec`:
  - radius 10
  - `__hd`: grid `28px | 1fr | auto`, padding 12/16
  - `__n`: 12px gray-200
  - `__h`: 12.5px / .06em / uppercase navy 700
- `.pdr-f`:
  - row `1fr | minmax(92px,max-content)`, padding 8, hairline
  - `__k`: 11.5px gray-700
  - `__req`: 9px/700 #C0392B on #FDECEC
  - `__t`: 10px gray-400
- `.pp-dot`: extracted #6A4FB3, review amber, verified green, disputed #C0392B, superseded gray-400, empty a hollow gray-200 ring.

**Table `.pt-lines`**
- th: 11px / .06em / 700 gray-500, padding 8/12, bottom border.
- td: padding 10/12, gray-100 hairline; gray-50 on hover.

## 1 · Pages

The design's NAV shows only **Cost Estimator** and **Port Settings**. Every other Ports page is reached from the estimator: its tabs, Setup links, the record slide-over, row clicks and the hub cards.

### P1 Cost Estimator (shell of `PdaRouteEstimator`)

**Head `.pe-head`**
- White, bottom border, padding 8/20.
- `.page-title`: 15px/600.
- Inline `.eyebrow`: 11px/600/.09em uppercase gray-500. Reads "A vessel and a cargo, and both port costs", or "vessel · cargo · POL → POD" once picked.
- Right side: icon buttons `.pe-iconbtn` 34×34 (count badge 15px blue) for Send for confirmation (Bell), Export (Doc) and Verification (Shield).

**Tabs**: Estimate · Ports · Agents · Setup, synced to the URL hash.

**Body `.pf`**
- padding 8/20, gap 8; cards use `--pf-sh`, radius 12, no border.
- Deal bar `.pf-deal`:
  - padding 8/16, gap 20, nowrap
  - each slot is an `auto | 1fr` grid: label 11px uppercase slate, then a typeahead (`border:0; radius 8; inset 0 0 0 1px gray-100; 13px; min-height 34`)
  - when picked, the slot shows name 15px/600, meta 13px, and a "New" button
- Empty card `.pf-empty`: padding 26/20, centred; `__t` 14.5px/600; `__s` 12.5px gray-700, max 520.

**Priced state**
- Answer strip `.pf-strip`: four gray-50 cells (radius 10, padding 14/16); the last cell is navy: both ports excl. handling · incl. handling & agency · transits · all-in.
- `.pf-two`: two columns, gap 18. Each `.pf-col` holds:
  - role pill (11px blue-light; discharge uses gold)
  - port name 17px plus meta 13px, and a "change" link
  - `.pf-fig__v` 27px/600
  - tweak wells: two-column gray-50 grid (radius 10, padding 12/14) for Days of stay / Berth shifts / ETA / Agent
  - handling `.pf-hd`
  - triggers `.pf-trig` (amber-bg, radius 10)
  - footer links: Breakdown · Port record · Port settings, plus "n not sourced"
  - breakdown `.pf-bd`: gray-50, radius 10
- Port record slide-over `.pe-rec`: fixed right, `min(940px,94vw)`, shadow `-10px 0 34px rgba(13,37,69,.18)`, scrim rgba(13,37,69,.3).

**No data yet**
- Verification count: no table, so show no badge; the panel says "No verification asked for yet."
- Overstay trigger: no port-settings store, so the trigger strip is omitted.

### P2 Ports tab (`PdaPortsWorkspace` body)
- **Band**: eyebrow "Ports Module · one record per port", title "Ports", sub "The map, then the ports one by one…", chips `• N ports` · `N with a tariff held` · `N records started`.
- **`.px-wrap`** (padding 0/24/60), top to bottom:
  - `.px-lede`: 12.5px/1.7, max 88ch
  - `.px-map`: 400px, `.5px line`, radius 10, gray-100. Pins: a held tariff is `#1B6FCB` 13px, otherwise `#C9D2DE` 9px, both with a 1.5px white ring. The map fits to the rows shown.
  - `.px-h` "PORT BY PORT" plus a hint
  - `.px-ctl`: search (12px, padding 5/9, radius 6, min 190), `.px-seg` All / Tariff held / No tariff, count
  - `.px-tbl`: th 9.5px/.06em faint on gray-50; td padding 8/10, 12px
- **Columns**: Port (name plus 10.5px code) · Country · Particulars · Operations · Costs · Commercial · Sources (`.px-cell` 22×8 radius 2: empty gray-100, extracted blue, review amber, verified #2E7D5B) · Tariff pack ("authority · N lines" or "none held") · Shape (Bundled / Itemised / Not sourced).
- **Data**: `list_pda_ports_workspace`.
  - Costs cell is extracted when a tariff is held.
  - The other cells are empty: there is no port-record table yet.
  - Records started = 0.
  - Shape is derived from rule bases, else "–".
  - A row opens P8.

### P3 Agents tab = Agent Portal (replaces `PdaAgentsWorkspace`; absorbs `PdaQuoteRequests` / `PdaAgencyInbox`)
- **Band `.ap-band`**: navy gradient, padding 14/20.
  - Eyebrow "Ports Module · Third-party access"; title "Agent Portal" 21px/700.
  - `.ap-viewtog`: rgba white .12, border .22, radius 8, padding 2. Buttons are 13px/600, padding 7/13, radius 6; `.is-on` is white/navy.
  - Views: Request PDAs · Agency workspace · ASB review (n).
- **`.ap-wrap`**: padding 16/20/60, gap 14, max 1060. `.ap-idbar` has a 34px blue-light avatar, name 14px, role 12px.
- **Agency view**:
  - PillTabs: Page & fees · Berthing notes · PDA requests (n) · Team · Submissions.
  - `.ap-cols`: `1.4fr | minmax(280px,1fr)`.
  - `.ap-panel`: radius 8, `--sh-card`. Fields are 11px/600 uppercase; inputs 14px, padding 8/10; gray-50 footer.
- **Request view**:
  - New PDA request panel: Port / Cargo / Vessel / Days alongside / Invite agents.
  - Quotes table `.ap-cmp`: Agent · Quoted PDA · vs estimate · Valid · Terms noted.
- **Review view**: Claim requests · Change sets · Decision log.
- **Data**:
  - Requests and quotes: existing.
  - Inbox: existing.
  - Coverage chips: `pda_port_agents`.
  - **Not recorded yet**: ops phone/email, published agency fee, berthing notes, submissions, claims, change sets, decision log, team.
  - Agency workspace shows only to agency staff; ASB review only to admins.

### P4 Setup tab (extends `PdaSetupWorkspace`)
- `.pe-set` (max 920):
  - card `.pe-set-card` (radius 10, gray-50 head)
  - pref rows with a dashed divider
  - link rows with a 30px blue-light tile
- **Cards**:
  - What you see: Row height · Handover note.
  - Port database and tariffs: Port settings · Ports · Port particulars · Tariff packs · Tariff pack record · Agents.
  - Reference: Tariff layouts · Record page pattern.
- **Data**: preferences exist. The handover note is new; store it in preferences or omit it.

### P5 Port Module hub
- `.pmx-arms` tabs: Quick DA · Setup & directory.
- **Quick DA**:
  - `.qd-bar`: Cargo / Vessel / Quantity.
  - `.qd-legs`: two cards with a 2px blue (POL) or green (POD) top border.
  - Navy CTA "Open in the PDA Estimator ›", linking with `?from=quick&cargoId&vesselId&load&disch&mt`.
- **Setup & directory**:
  - HeroBand with chips: touches · network · packs.
  - `.pm-cards`: two columns; 46px navy tile.
  - Most visited ports and Tariff coverage.
- **Data**: cargo/vessel/quantity from the member's records; touch counts from `cargo_listings`. Show "N lines": rules have no verified flag.

### P6 Port Directory
- Band. Search (260px) and zone chips.
- `.pt-lines` columns: Port · Targeting (#rank from touches, ▲▼⇅) · Country · Zone pill · Congestion · Indicative DA · Tariff · caret. Headers are sortable.
- **Not recorded yet**: specs, congestion, DA, sanctions.
- Zone colours: a constant in lib.

### P7 Ports Map (extends `PdaPortsMap`; map style unchanged by owner ruling)
- Head with targeted/network counts.
- Pins sized by touches.
- Popup and drawer use the design's own fallbacks ("No pack yet", "ask the attending agent", "Berths, LOA and draft not held").
- The drawer lists agents and the cargo and vessels at that port.

### P8 Port Particulars (RecordShell)
- Tabs: Particulars · Operations · Costs · Commercial · Sources. The field model is ported 1:1 from `port-particulars-model.js` to `lib/pda/port-record-model.ts`.
- **Real data**:
  - name / LOCODE / country / zone / lat-long from `ports`
  - Costs › tariff binding from `port_tariff_rules`
  - Commercial › agents from `list_pda_port_agents`
  - Sources from `tariff_sources`
  - terminals from `port_terminals`
- **Everything else**: empty hollow-dot slots ("Blank is a finding"). Status Draft, Verified 0 of N, Last verified "—". Contribution is disabled.

### P9 Port Settings
- `.ps-top`: port select, Broker / Third-party, Edit record, "Back to the estimate".
- Arms: Stay & triggers · Working pattern · Third parties · Tariff.
- `.ps-slot` rows: label, help, and a value with a "HOUSE DEFAULT" badge.
- **Data**: the Tariff arm is real (published versions). Other slots show only a house default the engine actually uses (e.g. turn allowance), else "Empty".

### P10 Attending Agent (`/dashboard/ports-da/agents/[orgId]`)
- `.ag-band`: Verified agency · N ports served · zones; "Manage page" for that agency's own staff only.
- `.pd-grid`: `1.55fr | minmax(300px,1fr)`. Panels: About (service chips) · Published agency fees · Contacts · Coverage.
- **Data**: `pda_agencies` and `pda_port_agents` ⨝ `ports`; member-since from `invited_at`.
- **Not recorded yet**: HQ, founded, blurb, contacts, fees, DA. There is no Owner mode.

### P11 Tariff Packs
- Band chips: packs · ports resolved · ports with more than one pack.
- `.tp-grid` (auto-fill minmax(320px)), one card per published version. Each card shows:
  - authority
  - provider
  - chips: shape · currency · Primary/Secondary
  - kv: Effective · Charge lines · Verified · Open findings
  - port chips
  - a link to "Open the pack record"
- Resolver table: Port | packs, amber when there are several.
- **Data**: published `port_tariff_versions` ⨝ sets ⨝ `tariff_publishers` ⨝ `tariff_sources` (Primary when `authority='official'`). Verified and findings are not recorded yet.

### P12 Tariff Pack record (RecordShell)
- Tabs: Pack · Layout · Charges · Hours · Sources (model `tariff-pack-model.js`).
- **Real**:
  - publisher name / country / website
  - source title / authority / URI / registered_at
  - version effective_from / version_no / currency / supersedes
  - set port / terminal
  - rules (label, basis, rate/amount, minimum, applicability, source page)
- **Empty**: layout, hours, findings, VAT/peg/escalation.

### P13 Tariff Layouts / P14 Record Page Pattern (reference pages)
- **Layouts**: 01 shapes, without figures. 05 "which port uses which layout" comes from the database. 02–04 and 06–07 show "Not recorded yet, needs a bundled pack".
- **Record Page Pattern**: the RecordShell spec; link it from Setup › Reference only.

## 2 · Deviations of the current implementation
- **Head**: should be 15/600 with an 11px gray-500 eyebrow. The Bell, Doc and Shield buttons are missing.
- **Tabs**: should be 9/14 at 13/600, with a bar padding of 24.
- **Cards**:
  - the listing-card strip from `lib/portal/portal.css` is already removed inside `.pda-route`
  - move to `--pf-sh`, radius 12
  - remove the amber `border-left` asides (use `.pf-trig`)
- Replace hard-coded hexes and 9–10px text with tokens and an 11px floor.
- **Saved estimates**: not on the design face. Move save/history behind the head's Export (Doc) action, or into a slide-over.
- **Call facts, timeline and summary tiles**: fold into the deal bar, answer strip, port columns and tweak wells.
- **Ports tab**: band plus arm bars plus Shape; a row opens the record.
- **Agents tab**: becomes the Agent Portal.
- **Setup**: add the Reference card and the full link list.
- **Agency inbox**: becomes the Agent Portal agency view.

## 3 · Build order (each increment shippable)
1. Shared CSS, the building blocks and the token overrides.
2. Estimator head, tabs and card language, with save/history moved behind Export (CSS and layout only).
3. Setup links (gated to routes that exist).
4. Ports tab: band plus arm grid.
5. Agent Portal: the Agents tab and the agency inbox.
6. Tariff Packs index (new read RPC `list_pda_tariff_packs`).
7. RecordShell plus the Tariff Pack record.
8. Port Particulars.
9. Port Settings.
10. Attending Agent page.
11. Port Directory, then the Ports Map, then the Quick DA hub (new read RPC `get_port_touch_census`).
12. Tariff Layouts.

New RPCs follow the private-by-default grants.
