# Broker Ledger — all pre-set dropdown values (business review copy)

Every fixed choice list on the **Post Cargo** and **Post Vessel** pages, with the
flyout definition shown to the user on hover. Compiled 31 Jul 2026 for personal
review by the business owner.

**Where they live:** all lists and wording sit in one file —
`components/ledger/defs.ts`. To change a value or its wording, edit there (or
just tell me what to change); nothing else needs touching unless noted.

**Sources:** `workbook` = UNIFIED workbook sheet 10_ENUMS via the Concept 4
design; `extended` = added after go-live at the owner's request (not in the
original design). Lists marked **DB** are live database content, not presets —
included at the end for completeness.

---

## Post Cargo page

### Cargo form / packaging — `workbook`
| Value | Definition shown |
|---|---|
| Bulk | Loaded loose into the hold, unpackaged. |
| Bagged (50 kg) | In standard 50 kg sacks, sling- or belt-loaded. |
| Big bags (1-1.5 t) | Flexible bulk bags (FIBC) of about 1 to 1.5 tonnes each. |
| Break-bulk | Individually handled pieces: crates, drums, bundles, coils, units. |
| Palletised | Stacked and strapped on pallets for fork-lift handling. |

### Volume unit — `workbook`
CbM · CbFT (converted 1 CbM = 35.3147 CbFT)

### Quantity option holder — `workbook`
| Value | Definition shown |
|---|---|
| MOLOO | More Or Less Owner's Option. The owner sets the final loaded quantity within the tolerance. |
| MOLCHOPT | More Or Less Charterer's Option. The charterer sets the final quantity within the tolerance. |

### Rate mechanism — `workbook`
| Value | Definition shown |
|---|---|
| Per day (MT/day) | Fixed tonnes per day. Laytime = quantity divided by the rate. |
| Per hatch / day | Rate multiplied by the number of hatches (BIMCO Laytime Definition 6). |
| Per working hatch / day | Largest hold divided by (rate times the hatches serving it), per BIMCO Definition 7. |
| CQD | Customary quick despatch. No fixed rate; worked as fast as the port allows. |
| Total days | A fixed total number of laytime days for the whole call. |

### Day type & exceptions — `workbook + extended (31 Jul 2026)`
The original design carried only 7 values (WWD FHEX, WWD SHINC, WWD SHEX, FHEX,
SHINC, SHEX EIU, CQD). Expanded to the full standard laytime set — the whole
Friday-included family was missing:

| Value | Definition shown | Source |
|---|---|---|
| WWD FHINC | Weather working days, Fridays and holidays included. | extended |
| WWD FHEX | Weather working days, Fridays and holidays excepted. Common across the Gulf and Red Sea. | workbook |
| WWD SHINC | Weather working days, Sundays and holidays included. | workbook |
| WWD SHEX | Weather working days, Sundays and holidays excepted. | workbook |
| FHINC | Fridays and holidays included. Every day counts where Friday is the rest day. | extended |
| FHEX | Fridays and holidays excepted. | workbook |
| FHEX EIU | Fridays and holidays excepted, even if used for cargo work. | extended |
| FHEX UU | Fridays and holidays excepted, unless used — time actually worked counts. | extended |
| SHINC | Sundays and holidays included. Every calendar day counts. | workbook |
| SHEX | Sundays and holidays excepted. | extended |
| SHEX EIU | Sundays and holidays excepted, even if used for cargo work. | workbook |
| SHEX UU | Sundays and holidays excepted, unless used — time actually worked counts. | extended |
| SSHINC | Saturdays, Sundays and holidays included. | extended |
| SSHEX | Saturdays, Sundays and holidays excepted. | extended |
| CQD | Customary quick despatch. No fixed laytime; cargo is worked as fast as the port customarily allows. | workbook |

### Laytime reversibility — `workbook`
| Value (shown as) | Meaning |
|---|---|
| Non-reversible (Separate) | Load and discharge laytime counted separately. |
| Reversible | Charterer may add load + discharge time into one pool (BIMCO def 24). |
| Average | Time saved at one end offsets excess at the other (BIMCO def 23). |

### Freight basis — `workbook`
| Value | Definition shown |
|---|---|
| Per MT | Freight priced per metric tonne of cargo loaded. |
| Lumpsum | One fixed freight for the whole cargo, whatever the final quantity. |

### Despatch — `workbook`
| Value | Definition shown |
|---|---|
| Half demurrage | Despatch paid at half the demurrage rate for laytime saved. The market norm. |
| No despatch | No money paid to the charterer for finishing early. |
| Free of despatch | Laytime is free of despatch; the owner owes nothing for time saved. |

### NOR clause — `workbook`
| Value | Definition shown |
|---|---|
| WIPON WIBON WIFPON WICCON | Notice may be tendered Whether In Port Or Not, Whether In Berth Or Not, Whether In Free Pratique Or Not, Whether In Customs Clearance Or Not. |
| On arrival / ATDN | NOR valid once the ship arrives, tendered Any Time Day or Night. |
| Turn time 12h once NOR tendered | A fixed 12-hour allowance after NOR is tendered before laytime starts to count. |

---

## Post Vessel page

### Vessel type — `workbook`
| Value | Definition shown |
|---|---|
| Bulk Carrier | Single-deck ship built to carry unpackaged dry bulk (grain, ore, coal, cement) loose in the hold. |
| General Cargo | Multipurpose dry-cargo ship for bagged, packaged and break-bulk goods and light bulk. Usually geared, often with tween decks. |

### Vessel configuration — `workbook`
| Value | Definition shown |
|---|---|
| Geared Bulk Carrier | Bulk carrier fitted with its own cranes or derricks, so it can load and discharge at berths that have no shore gear. |
| Multi Purpose | Flexible MPP vessel carrying a mix of general cargo, bulk, containers and project or heavy-lift pieces. Usually geared with box-shaped holds. |
| Open Hatch | Bulker with full-width box holds and hatches that open almost the full breadth, for vertical, damage-free loading of unitised cargo such as forest products and steel. |

### Availability status — `workbook`
| Value | Definition shown |
|---|---|
| Open | Free and available to fix at the stated position and dates. |
| Fixed | Already committed to a charter. Shown for reference, not on offer. |
| On Subs | On subjects. A fixture is provisionally agreed, pending subjects being lifted. |
| Ballast | Sailing empty toward the open area. Not yet at the open port. |
| Off-hire | Temporarily out of service (repairs, survey). Not available. |

### Charter type — `workbook`
| Value | Definition shown |
|---|---|
| V/C | Voyage charter. Owner carries a set cargo between named ports for freight per tonne or lumpsum. |
| TCT | Time-charter trip. Hired for a single trip, paid at a daily hire rate. |
| T/C short | Short-period time charter. Hired by the day for weeks or a few months. |
| T/C long | Long-period time charter. Hired by the day for many months or years. |
| Bareboat | Bareboat (demise) charter. Charterer takes full operational control and crews the ship. |

### Hatch type — `workbook`
| Value | Definition shown |
|---|---|
| side-rolling | Covers roll sideways on rails to open. Fast, gives a clear hatch; common on modern bulkers. |
| folding | Hinged panels that fold upright hydraulically. Quick to work, popular on handies. |
| pontoon | Separate portable slabs lifted on and off by crane. Simple but slower to open. |
| lift-away | Single-piece covers craned off and stowed ashore or on deck. Gives a fully open hatch. |

### Fuel type — `workbook` (Dual definition added 31 Jul 2026 — it had no flyout)
| Value | Definition shown |
|---|---|
| VLSFO | Very Low Sulphur Fuel Oil, max 0.50% sulphur. The IMO 2020 standard heavy fuel. |
| LSMGO | Low Sulphur Marine Gas Oil, max 0.10% sulphur. Distillate burned inside ECAs. |
| HFO 380 | Heavy Fuel Oil at 380 cSt. High-sulphur residual; needs a scrubber to burn legally. |
| MGO | Marine Gas Oil. A clean distillate, dearer than the residual fuels. |
| Dual | Dual-fuel plant. Burns conventional fuel or an alternative such as LNG or methanol. |

---

## Shared lists

### Trading zones (18, both pages / map picker) — `field spec`
Arabian Gulf · Arabian Sea · Red Sea North · Red Sea South · East Med ·
Black Sea · Central Med · West Med · Adriatic · West Africa · East Africa ·
West Coast India · East Coast India · Continent · Far East ·
East Coast S. America · Caribbean · Baltic

### Flag states (vessel flag picker) — `curated list`
~100 country names in `lib/geo/countries.ts`, common open registries first
(Panama, Liberia, Marshall Islands, …). Free text is still accepted, so a
missing country never blocks a posting — but tell me any you want listed.

### Live database content (not presets — managed via data, not this file)
- **Commodities** — workbook market names / grain list / IMSBC / CSS tables.
- **Ports** — curated `ports` table (278 active) + UN/LOCODE backstop search.
- **Companies** — 88-firm registry (`organizations`).
- **Vessel registry** — `vessels` table (workbook fleet + user-added).

---

*Process note: values marked `workbook` are business-approved wording carried
verbatim from the Concept 4 handoff. The `extended` day-type values are pending
your review — reject or reword any of them and I will adjust `defs.ts` and the
`cargo_listings.day_exceptions` column comment together.*
