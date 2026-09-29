// Fixture Room · hover glossary for standard chartering abbreviations, as in
// the design (asb/negotiation-room). Pure data plus a tokenizer the Gloss
// component uses; nothing here touches commercial state.

export const FIXTURE_GLOSSARY: Readonly<Record<string, string>> = {
  SF: "Stowage factor", MT: "Metric ton (1,000 kg)", WMT: "Wet metric tons",
  MOLOO: "More or less, owners' option", MOLCHOPT: "More or less, charterers' option",
  SB: "Safe berth", SP: "Safe port", BENDS: "Both ends (load & discharge)",
  NOR: "Notice of readiness", WIBON: "Whether in berth or not", WIPON: "Whether in port or not",
  WCCON: "Whether customs cleared or not", WIFPON: "Whether in free pratique or not", WWWW: "WIBON, WCCON, WIFPON, WIPON",
  LAYCAN: "Laydays & cancelling date", ETA: "Estimated time of arrival",
  WWD: "Weather working day", WP: "Weather permitting", SHINC: "Sundays & holidays included", SHEX: "Sundays & holidays excluded",
  CQD: "Customary quick despatch", FAC: "Fast as can", PWWD: "Per weather working day",
  FIOST: "Free in/out, stowed & trimmed", FIO: "Free in/out", FIOS: "Free in/out & stowed", FIOT: "Free in/out & trimmed",
  FOB: "Free on board", CIF: "Cost, insurance & freight", CFR: "Cost & freight",
  LS: "Lumpsum", BSS: "Basis", DEM: "Demurrage", DES: "Despatch",
  DHDATSBE: "Dem half despatch, all time saved both ends", PDPR: "Per day or pro rata", WOG: "Without guarantee",
  ADCOM: "Address commission", ADDCOMM: "Address commission", "C/P": "Charterparty",
  "S/R/B/L": "Signed & released bills of lading", LOI: "Letter of indemnity",
  AGW: "All going well", TBN: "To be nominated", IMSBC: "Intl Maritime Solid Bulk Cargoes code", HSS: "Heavy sorghums & soyas", SUB: "Subject to",
  DWT: "Deadweight tonnage", SPOT: "Prompt · ready now",
};

/** Split text into tokens, marking those that carry a glossary entry. */
export function glossTokens(text: string | null | undefined): { tok: string; full: string | null }[] {
  if (text == null || text === "") return [];
  return String(text).split(/(\s+)/).filter((t) => t !== "").map((tok) => {
    if (/^\s+$/.test(tok)) return { tok, full: null };
    const key = tok.replace(/[^A-Za-z/]/g, "").toUpperCase();
    let full = FIXTURE_GLOSSARY[key] ?? null;
    if (!full && key.indexOf("/") > 0) full = FIXTURE_GLOSSARY[key.split("/")[0]] ?? null;
    return { tok, full };
  });
}
