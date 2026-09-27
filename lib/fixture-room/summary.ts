// Fixture Room · the deal summary the header exports (design: "Export deal
// summary"). Built from the masked read model the viewer already holds, so
// it can never show more than the screen does: counterparty names only after
// disclosure, no person, email or phone, TBN identifiers withheld. Plain text
// in Phase 1.1; the PDF documents of Phase 1.1 commit 4 replace the download.
import type { FixtureRoomView } from "./types";
import { ROOM_STATUS_LABEL } from "./state-machine";

const line = (k: string, v: string | number | null | undefined) => `${k.padEnd(8)}${v == null || v === "" ? "—" : String(v)}`;

export function buildDealSummary(view: FixtureRoomView, at = new Date()): string {
  const { room, snapshot, terms, subjects, parties } = view;
  const cargo = snapshot.cargo;
  const vessel = snapshot.vessel.vessel;
  const cp = parties.filter((p) => p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel"));
  const L: string[] = [];
  L.push("ARAB SHIPBROKER · FIXTURE SUMMARY");
  L.push("=================================");
  L.push(line("Ref:", `${room.ref} · v${room.version}`));
  L.push(line("Date:", at.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })));
  L.push(line("Status:", ROOM_STATUS_LABEL[room.status].toUpperCase()));
  L.push("");
  L.push(line("Cargo:", `${cargo.commodity_name ?? "—"} · ${cargo.qty_min_mt ?? "—"}–${cargo.qty_max_mt ?? "—"} MT`));
  L.push(line("Route:", `${cargo.load_port_name ?? cargo.load_port_locode ?? "—"} → ${cargo.disch_port_name ?? cargo.disch_port_locode ?? "—"}`));
  L.push(line("Vessel:", `${vessel.vessel_name ?? "TBN"}${vessel.vessel_type ? ` (${vessel.vessel_type})` : ""}${snapshot.vesselIdentityMasked ? " · identity withheld" : ""}`));
  for (const p of cp) L.push(line(p.side === "cargo" ? "Cargo:" : "Vessel:", `${p.name ?? `${p.label} (via ASB, masked)`}${p.deskLabel ? ` · ${p.deskLabel}` : ""}`));
  L.push("");
  L.push("MAIN TERMS");
  L.push("----------");
  for (const t of [...terms].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const val = t.status === "agreed" ? t.agreed?.displayValue ?? "" : `cargo ${t.cargoPosition?.displayValue ?? "—"} · vessel ${t.vesselPosition?.displayValue ?? "—"}`;
    const st = t.status === "agreed" ? "AGREED" : t.status.toUpperCase();
    L.push(`${t.sortOrder}. ${t.label}: ${val}  [${st}]${t.round ? ` · R${t.round}` : ""}`);
  }
  L.push("");
  L.push("SUBJECTS");
  L.push("--------");
  if (subjects.length === 0) L.push("- none recorded");
  for (const s of subjects) L.push(`- ${s.title}${s.status !== "open" ? ` (${s.status.toUpperCase()})` : ""}`);
  L.push("");
  L.push("Brokerage: Arab ShipBroker · as per the platform terms.");
  L.push("Sub all terms / details of C/P otherwise as per owners' proforma.");
  return L.join("\n");
}

/** Trigger a browser download of the summary; no-op outside a browser. */
export function downloadText(filename: string, text: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
