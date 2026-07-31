// Broker Ledger — enums + field-definition flyout copy.
// Wording is business-approved and copied verbatim from the handoff step
// registries (reference/handoff/asb/pc2-steps.jsx / pp2-steps.jsx); the enums
// mirror the UNIFIED workbook 10_ENUMS via reference/handoff/asb/pp2-data.js
// and pc2-data.js. Change wording only with business sign-off.

import { ZONES, type ZoneCode } from "@/lib/zones";

// ── enums (workbook 10_ENUMS) ────────────────────────────────────────────────
export const LEDGER_ENUMS = {
  vesselType: ["Bulk Carrier", "General Cargo"],
  vesselConfig: ["Geared Bulk Carrier", "Multi Purpose", "Open Hatch"],
  charterType: ["V/C", "TCT", "T/C short", "T/C long", "Bareboat"],
  status: ["Open", "Fixed", "On Subs", "Ballast", "Off-hire"],
  hatchType: ["side-rolling", "folding", "pontoon", "lift-away"],
  fuelType: ["VLSFO", "LSMGO", "HFO 380", "MGO", "Dual"],
  cargoForm: ["Bulk", "Bagged (50 kg)", "Big bags (1-1.5 t)", "Break-bulk", "Palletised"],
  volumeUnit: ["CbM", "CbFT"],
  optionHolder: ["MOLOO", "MOLCHOPT"],
  rateMechanism: ["Per day (MT/day)", "Per hatch / day", "Per working hatch / day", "CQD", "Total days"],
  // Extended beyond workbook 10_ENUMS (owner request, 31 Jul 2026) to the full
  // standard laytime day-type set — Friday-based (Gulf/Red Sea) and
  // Sunday-based variants each with INC/EX/EIU/UU forms. Review list:
  // docs/ledger-preset-values.md.
  dayExceptions: [
    "WWD FHINC", "WWD FHEX", "WWD SHINC", "WWD SHEX",
    "FHINC", "FHEX", "FHEX EIU", "FHEX UU",
    "SHINC", "SHEX", "SHEX EIU", "SHEX UU",
    "SSHINC", "SSHEX", "CQD",
  ],
  reversible: ["Non-reversible", "Reversible", "Average"],
  freightBasis: ["Per MT", "Lumpsum"],
  despatch: ["Half demurrage", "No despatch", "Free of despatch"],
  norClause: ["WIPON WIBON WIFPON WICCON", "On arrival / ATDN", "Turn time 12h once NOR tendered"],
} as const;

// ── vessel availability status → vessel_status_enum ─────────────────────────
export const STATUS_TO_ENUM: Record<string, string> = {
  Open: "OPEN",
  Fixed: "FIXED",
  "On Subs": "ON SUBS",
  Ballast: "BALLAST",
  "Off-hire": "OFF-HIRE",
};

// ── trading-zone display list (design shows 18 named zones) ─────────────────
// Each display zone maps down to a zone_enum code for persistence. Red Sea
// North & South are separate zones per the field spec (dedicated enum values).
export const TRADING_ZONES: { label: string; code: ZoneCode }[] = [
  { label: "Arabian Gulf", code: "AG" },
  { label: "Arabian Sea", code: "A.SEA" },
  { label: "Red Sea North", code: "R.SEA.N" },
  { label: "Red Sea South", code: "R.SEA.S" },
  { label: "East Med", code: "E.MED" },
  { label: "Black Sea", code: "B.SEA" },
  { label: "Central Med", code: "C.MED" },
  { label: "West Med", code: "W.MED" },
  { label: "Adriatic", code: "ADRIATIC" },
  { label: "West Africa", code: "WCAF" },
  { label: "East Africa", code: "ECAF" },
  { label: "West Coast India", code: "WCI" },
  { label: "East Coast India", code: "ECI" },
  { label: "Continent", code: "NCONT" },
  { label: "Far East", code: "F.EAST" },
  { label: "East Coast S. America", code: "ECSA" },
  { label: "Caribbean", code: "CARIB" },
  { label: "Baltic", code: "BALTIC" },
];

export const tradingZoneCode = (label: string): ZoneCode | null =>
  TRADING_ZONES.find((z) => z.label === label)?.code ?? null;

export const zoneDisplayName = (code?: string | null): string | null =>
  code ? (ZONES as Record<string, { label: string }>)[code]?.label ?? code : null;

// ── niche size gate (QC-13, locked 08 Jul 2026) ──────────────────────────────
export const SIZE_GATE_DWT = 66000;

// ── laycan window cap (11_VALIDATION) ────────────────────────────────────────
export const LAYCAN_CAP_DAYS = 45;

// ── definition flyouts — cargo ───────────────────────────────────────────────
export const DAY_DEFS: Record<string, string> = {
  "WWD FHINC": "Weather working days, Fridays and holidays included.",
  "WWD FHEX": "Weather working days, Fridays and holidays excepted. Common across the Gulf and Red Sea.",
  "WWD SHINC": "Weather working days, Sundays and holidays included.",
  "WWD SHEX": "Weather working days, Sundays and holidays excepted.",
  FHINC: "Fridays and holidays included. Every day counts where Friday is the rest day.",
  FHEX: "Fridays and holidays excepted.",
  "FHEX EIU": "Fridays and holidays excepted, even if used for cargo work.",
  "FHEX UU": "Fridays and holidays excepted, unless used — time actually worked counts.",
  SHINC: "Sundays and holidays included. Every calendar day counts.",
  SHEX: "Sundays and holidays excepted.",
  "SHEX EIU": "Sundays and holidays excepted, even if used for cargo work.",
  "SHEX UU": "Sundays and holidays excepted, unless used — time actually worked counts.",
  SSHINC: "Saturdays, Sundays and holidays included.",
  SSHEX: "Saturdays, Sundays and holidays excepted.",
  CQD: "Customary quick despatch. No fixed laytime; cargo is worked as fast as the port customarily allows.",
};

export const RATE_DEFS: Record<string, string> = {
  "Per day (MT/day)": "Fixed tonnes per day. Laytime = quantity divided by the rate.",
  "Per hatch / day": "Rate multiplied by the number of hatches (BIMCO Laytime Definition 6).",
  "Per working hatch / day": "Largest hold divided by (rate times the hatches serving it), per BIMCO Definition 7.",
  CQD: "Customary quick despatch. No fixed rate; worked as fast as the port allows.",
  "Total days": "A fixed total number of laytime days for the whole call.",
};

export const CARGOFORM_DEFS: Record<string, string> = {
  Bulk: "Loaded loose into the hold, unpackaged.",
  "Bagged (50 kg)": "In standard 50 kg sacks, sling- or belt-loaded.",
  "Big bags (1-1.5 t)": "Flexible bulk bags (FIBC) of about 1 to 1.5 tonnes each.",
  "Break-bulk": "Individually handled pieces: crates, drums, bundles, coils, units.",
  Palletised: "Stacked and strapped on pallets for fork-lift handling.",
};

export const OPTHOLDER_DEFS: Record<string, string> = {
  MOLOO: "More Or Less Owner's Option. The owner sets the final loaded quantity within the tolerance.",
  MOLCHOPT: "More Or Less Charterer's Option. The charterer sets the final quantity within the tolerance.",
};

export const NOR_DEFS: Record<string, string> = {
  "WIPON WIBON WIFPON WICCON":
    "Notice may be tendered Whether In Port Or Not, Whether In Berth Or Not, Whether In Free Pratique Or Not, Whether In Customs Clearance Or Not.",
  "On arrival / ATDN": "NOR valid once the ship arrives, tendered Any Time Day or Night.",
  "Turn time 12h once NOR tendered": "A fixed 12-hour allowance after NOR is tendered before laytime starts to count.",
};

export const FBASIS_DEFS: Record<string, string> = {
  "Per MT": "Freight priced per metric tonne of cargo loaded.",
  Lumpsum: "One fixed freight for the whole cargo, whatever the final quantity.",
};

export const DESPATCH_DEFS: Record<string, string> = {
  "Half demurrage": "Despatch paid at half the demurrage rate for laytime saved. The market norm.",
  "No despatch": "No money paid to the charterer for finishing early.",
  "Free of despatch": "Laytime is free of despatch; the owner owes nothing for time saved.",
};

// ── definition flyouts — vessel ──────────────────────────────────────────────
export const VTYPE_DEFS: Record<string, string> = {
  "General Cargo":
    "Multipurpose dry-cargo ship for bagged, packaged and break-bulk goods and light bulk. Usually geared, often with tween decks.",
  "Bulk Carrier": "Single-deck ship built to carry unpackaged dry bulk (grain, ore, coal, cement) loose in the hold.",
};

export const CONFIG_DEFS: Record<string, string> = {
  "Geared Bulk Carrier":
    "Bulk carrier fitted with its own cranes or derricks, so it can load and discharge at berths that have no shore gear.",
  "Multi Purpose":
    "Flexible MPP vessel carrying a mix of general cargo, bulk, containers and project or heavy-lift pieces. Usually geared with box-shaped holds.",
  "Open Hatch":
    "Bulker with full-width box holds and hatches that open almost the full breadth, for vertical, damage-free loading of unitised cargo such as forest products and steel.",
};

export const HATCH_DEFS: Record<string, string> = {
  "side-rolling": "Covers roll sideways on rails to open. Fast, gives a clear hatch; common on modern bulkers.",
  folding: "Hinged panels that fold upright hydraulically. Quick to work, popular on handies.",
  pontoon: "Separate portable slabs lifted on and off by crane. Simple but slower to open.",
  "lift-away": "Single-piece covers craned off and stowed ashore or on deck. Gives a fully open hatch.",
};

export const STATUS_DEFS: Record<string, string> = {
  Open: "Free and available to fix at the stated position and dates.",
  Fixed: "Already committed to a charter. Shown for reference, not on offer.",
  "On Subs": "On subjects. A fixture is provisionally agreed, pending subjects being lifted.",
  Ballast: "Sailing empty toward the open area. Not yet at the open port.",
  "Off-hire": "Temporarily out of service (repairs, survey). Not available.",
};

export const CHARTER_DEFS: Record<string, string> = {
  "V/C": "Voyage charter. Owner carries a set cargo between named ports for freight per tonne or lumpsum.",
  TCT: "Time-charter trip. Hired for a single trip, paid at a daily hire rate.",
  "T/C short": "Short-period time charter. Hired by the day for weeks or a few months.",
  "T/C long": "Long-period time charter. Hired by the day for many months or years.",
  Bareboat: "Bareboat (demise) charter. Charterer takes full operational control and crews the ship.",
};

export const FUEL_DEFS: Record<string, string> = {
  VLSFO: "Very Low Sulphur Fuel Oil, max 0.50% sulphur. The IMO 2020 standard heavy fuel.",
  LSMGO: "Low Sulphur Marine Gas Oil, max 0.10% sulphur. Distillate burned inside ECAs.",
  "HFO 380": "Heavy Fuel Oil at 380 cSt. High-sulphur residual; needs a scrubber to burn legally.",
  MGO: "Marine Gas Oil. A clean distillate, dearer than the residual fuels.",
  Dual: "Dual-fuel plant. Burns conventional fuel or an alternative such as LNG or methanol.",
};
