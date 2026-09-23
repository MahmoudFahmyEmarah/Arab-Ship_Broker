// Presentation helpers for staged rows — pure, dependency-free, so the unit
// checks can exercise them and both the Review list and the row drawer share
// one rendering of "what is this row".

/** Build the "extracted fields" list from a staged row's payload (curated for
 *  cargo/vessels, generic otherwise). */
export function extractedFields(payload: Record<string, unknown>, sheetId: string): { label: string; value: string }[] {
  const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : s(v));
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  const port = (name: string, loc: string, zone: string) => {
    const nm = s(payload[name]); const lc = s(payload[loc]); const zn = s(payload[zone]);
    if (!nm && !lc && !zn) return null;
    return `${nm ?? "—"}${lc ? ` (${lc})` : ""}${zn ? ` · ${zn}` : ""}`;
  };
  let pairs: [string, string | null][];
  if (sheetId === "cargo") {
    const qty = payload.qty_min_mt != null || payload.qty_max_mt != null ? `${n(payload.qty_min_mt) ?? "—"} – ${n(payload.qty_max_mt) ?? "—"}` : null;
    pairs = [
      ["REF", s(payload.ref)],
      ["CARGO_TYPE", s(payload.cargo_type)],
      ["COMMODITY", s(payload.commodity_name)],
      ["LOAD", port("load_port_name", "load_port_locode", "load_zone")],
      ["DISCHARGE", port("disch_port_name", "disch_port_locode", "disch_zone")],
      ["QTY (MT)", qty],
      ["LAYCAN", join(s(payload.laycan_from), s(payload.laycan_to))],
      ["ASB_REGIME", s(payload.asb_regime)],
      ["LOAD / DISCH RATE", join(s(payload.load_rate), s(payload.disch_rate))],
      ["LAYTIME", s(payload.laytime_structure)],
      ["LOAD_TERMS", s(payload.load_terms)],
      ["FREIGHT (USD/MT)", n(payload.freight_idea_usd_mt)],
      ["COMMISSION_PCT", n(payload.commission_pct)],
      ["BROKER", s(payload.broker)],
      ["NOTES", s(payload.notes)],
    ];
  } else if (sheetId === "vessels") {
    pairs = [
      ["IMO", s(payload.imo_number)],
      ["VESSEL_NAME", s(payload.vessel_name)],
      ["VESSEL_TYPE", s(payload.vessel_type)],
      ["DWT", n(payload.dwt_grain)],
      ["FLAG", s(payload.flag)],
      ["BUILT", s(payload.build_year)],
    ];
  } else {
    pairs = Object.entries(payload).filter(([k, v]) => v != null && v !== "" && k !== "is_spot").map(([k, v]) => [k.toUpperCase(), n(v)]);
  }
  return pairs.filter(([, v]) => v != null).map(([label, value]) => ({ label, value: value as string }));
}

/** One-line human summary of a staged row, for the grouped list. */
export function rowSummary(payload: Record<string, unknown>, sheetId: string): string {
  const s = (k: string) => {
    const v = payload[k];
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  if (sheetId === "cargo") {
    const qty = payload.qty_min_mt != null ? `${Number(payload.qty_min_mt).toLocaleString("en-US")} mt` : null;
    return [s("commodity_name"), qty, [s("load_port_name"), s("disch_port_name")].filter(Boolean).join(" → ") || null]
      .filter(Boolean).join(" · ") || "—";
  }
  if (sheetId === "vessels") {
    const dwt = payload.dwt_grain != null ? `${Number(payload.dwt_grain).toLocaleString("en-US")} dwt` : null;
    return [s("vessel_name"), dwt, s("vessel_type"), s("flag")].filter(Boolean).join(" · ") || "—";
  }
  if (sheetId === "ports") {
    return [s("port_name"), s("locode"), s("country")].filter(Boolean).join(" · ") || "—";
  }
  const first = Object.entries(payload).find(([k, v]) => v != null && v !== "" && k !== "is_spot");
  return first ? String(first[1]) : "—";
}
