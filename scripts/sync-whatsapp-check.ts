/**
 * WhatsApp source check — pure logic, no network/DB. Run:
 *   npx tsx scripts/sync-whatsapp-check.ts
 * Covers: webhook signature verify, Meta payload extraction, ack/teaser
 * composition (REDACTION guarantees), template render, match scoring, WA- refs.
 */
import { createHmac } from "node:crypto";
import { verifyMetaSignature, extractMetaTexts } from "@/lib/sync/whatsapp/security";
import { composeExtractSummary, renderTemplate, maskName, composeTeaser } from "@/lib/sync/whatsapp/ack";
import {
  qtyFitScore, zoneScore, band, scoreVesselForCargo, scoreCargoForVessel,
  zoneProximityScore, directionScore, portAffinityScore,
} from "@/lib/sync/match";
import { vesselSummary } from "@/lib/sync/whatsapp/ack";
import type { VesselRecord } from "@/lib/sync/email/types";
import { recordsToSheets } from "@/lib/sync/email/to-rows";
import { PROVISIONAL_REF_RE } from "@/lib/sync/sheets";
import type { CargoRecord } from "@/lib/sync/email/types";

let pass = 0, fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ── webhook signature ────────────────────────────────────────────────────────
{
  console.log("webhook signature:");
  const secret = "app-secret-123";
  const body = JSON.stringify({ hello: "world" });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  ok(verifyMetaSignature(body, sig, secret) === true, "valid signature accepted");
  ok(verifyMetaSignature(body, sig, "wrong") === false, "wrong secret rejected");
  ok(verifyMetaSignature(body + "x", sig, secret) === false, "tampered body rejected");
  ok(verifyMetaSignature(body, null, secret) === false, "missing header rejected");
  ok(verifyMetaSignature(body, "sha256=zzzz", secret) === false, "malformed hex rejected (no crash)");
}

// ── Meta payload extraction ─────────────────────────────────────────────────
{
  console.log("meta payload extraction:");
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: "201000000", profile: { name: "Tasos" } }],
      messages: [
        { id: "wamid.1", from: "201000000", type: "text", text: { body: "5000 mt urea" }, timestamp: "1751700000" },
        { id: "wamid.2", from: "201000000", type: "image" },
      ],
    } }] }],
  };
  const texts = extractMetaTexts(payload);
  ok(texts.length === 1, "text extracted, non-text skipped");
  ok(texts[0].waMessageId === "wamid.1" && texts[0].name === "Tasos", "id + contact name mapped");
  ok(extractMetaTexts(null).length === 0, "null payload → empty (no crash)");
  ok(extractMetaTexts({ entry: [{ changes: [{}] }] }).length === 0, "partial payload → empty");
}

// ── ack composition + REDACTION guarantee ───────────────────────────────────
{
  console.log("ack redaction:");
  const cargo: CargoRecord[] = [{
    ref: "WA-ABC12345", cargo_type: "Dry Bulk", commodity: "wheat",
    qty_min_mt: 22500, qty_max_mt: 27500, load_port: "Pivdennyi", load_zone: "B.SEA",
    disch_port: "Alexandria", disch_zone: "E.MED", laycan_from: "2026-07-12", laycan_to: "2026-07-20",
    commission_pct: 2.5, freight_idea: 28.5, broker: "Tasos Koumanis",
    load_rate: "8000 SSHEX", disch_rate: "4000", laytime_structure: "8000/4000 SSHEX",
    notes: "WOG, owner ideas low 20s", asb_regime: "GRAIN",
  }];
  const s = composeExtractSummary(cargo, []);
  ok(s.includes("wheat") && s.includes("22,500") && s.includes("Pivdennyi"), "operational fields present");
  ok(s.includes("2026-07-12"), "laycan present");
  ok(!s.includes("2.5") && !/commission/i.test(s), "commission NEVER present");
  ok(!s.includes("28.5") && !/freight/i.test(s), "freight idea NEVER present");
  ok(!s.includes("Koumanis") && !/broker/i.test(s), "broker NEVER present");
  ok(!s.includes("8000") && !/SSHEX/.test(s), "rates NEVER present");
  ok(!/WOG|owner ideas/i.test(s), "notes NEVER present");

  const t = renderTemplate("Hi {{name}}!\n{{summary}}\n{{url}}", { name: "Tasos", summary: s, url: "https://x.com" });
  ok(t.startsWith("Hi Tasos!") && t.includes("https://x.com"), "template placeholders filled");
}

// ── teaser masking ──────────────────────────────────────────────────────────
{
  console.log("teaser masking:");
  ok(maskName("MV AURORA STAR") === "MV A••••• S•••", `vessel name masked (${maskName("MV AURORA STAR")})`);
  ok(maskName(null) === "•••••", "null name masked");
  const teaser = composeTeaser([
    { kind: "vessel", label: "MV AURORA", facts: ["28,500 DWT", "built 2011"], band: "Strong", score: 95, origin: "live" },
  ], "https://arabshipbroker.com");
  ok(!teaser.includes("AURORA"), "vessel identity never revealed in teaser");
  ok(teaser.includes("28,500 DWT") && teaser.includes("arabshipbroker.com"), "facts + url present");
  const empty = composeTeaser([], "https://x.com");
  ok(empty.includes("scanning the market"), "empty-matches teaser still engages");
}

// ── match scoring ───────────────────────────────────────────────────────────
{
  console.log("match scoring:");
  ok(qtyFitScore(25000, 27500, 28000) === 60, "tight qty fit → 60");
  ok(qtyFitScore(25000, 27500, 40000) === 45, "medium util (0.69) → 45");
  ok(qtyFitScore(25000, 27500, 60000) === 30, "low util (0.46) → 30");
  ok(qtyFitScore(25000, 27500, 20000) === 0, "cargo doesn't fit → 0");
  ok(qtyFitScore(5000, 10000, 8000) === 30, "min fits, max doesn't → 30");
  ok(zoneScore("B.SEA", ["B.SEA", "E.MED"]) === 40, "zone hit → 40");
  ok(zoneScore("B.SEA", ["AG"]) === 0, "zone miss → 0");
  ok(zoneScore(null, null) === 15, "unknown zones → neutral 15");
  ok(band(100) === "Strong" && band(60) === "Good" && band(30) === "Possible" && band(10) === null, "bands");

  const strong = scoreVesselForCargo(
    { qty_min_mt: 25000, qty_max_mt: 27500, load_zone: "B.SEA" },
    { vessel_name: "MV X", dwt_grain: 28000, build_year: 2011, preferred_zones: ["B.SEA"], origin: "live" },
  );
  ok(strong?.band === "Strong", "tight fit + zone → Strong");
  const rejected = scoreVesselForCargo(
    { qty_min_mt: 25000, qty_max_mt: 27500, load_zone: "AG" },
    { vessel_name: "MV Y", dwt_grain: 12000, build_year: null, preferred_zones: ["B.SEA"], origin: "draft" },
  );
  ok(rejected === null, "no fit + zone miss → rejected");
  const cargoMatch = scoreCargoForVessel(
    { dwt_grain: 28000, preferred_zones: null },
    { ref: "CM-1", commodity_name: "wheat", qty_min_mt: 25000, qty_max_mt: 27000, load_zone: "B.SEA",
      load_country: "Ukraine", load_port_name: "Odesa", disch_port_name: "Alexandria", disch_zone: "E.MED",
      laycan_from: "2026-07-15", origin: "draft" },
  );
  ok(cargoMatch?.kind === "cargo" && cargoMatch.origin === "draft", "vessel→cargo draft match");
  ok((cargoMatch?.facts.join(" ") ?? "").includes("Odesa → Alexandria"), "route in facts");
}

// ── geo-aware scoring (the Mostaganem → Black Sea scenario) ─────────────────
{
  console.log("geo-aware scoring:");
  ok(zoneProximityScore("W.MED", "W.MED") === 40, "same zone → 40");
  ok(zoneProximityScore("W.MED", "C.MED") === 25, "neighbour zone (W.MED↔C.MED) → 25");
  ok(zoneProximityScore("W.MED", "NCONT") === 25, "neighbour zone (W.MED↔NCONT) → 25");
  ok(zoneProximityScore("W.MED", "B.SEA") === 0, "far zone → 0");
  ok(zoneProximityScore(null, "W.MED") === 15, "unknown → neutral 15");
  ok(directionScore(["B.SEA", "E.MED"], "B.SEA") === 20, "cargo discharges where she wants → 20");
  ok(directionScore(["B.SEA"], "E.MED") === 10, "adjacent to desired → 10");
  ok(directionScore(["B.SEA"], "AG") === 0, "wrong direction → 0");
  ok(directionScore(null, "B.SEA") === 8, "no direction stated → mild neutral");
  ok(portAffinityScore("Mostaganem", "Algeria", "MOSTAGANEM", null) === 10, "same port name → +10");
  ok(portAffinityScore(null, "Algeria", "Oran", "Algeria") === 10, "same country → +10");
  ok(portAffinityScore("Mostaganem", "Algeria", "Odesa", "Ukraine") === 0, "unrelated → 0");

  // 17k dwt open Mostaganem (W.MED) wanting B.SEA/Turkey vs an Algerian cargo to Marmara
  const m = scoreCargoForVessel(
    { dwt_grain: 17000, open_zone: "W.MED", open_port: "Mostaganem", open_country: "Algeria", dest_zones: ["B.SEA", "E.MED"] },
    { ref: "CM-1", commodity_name: "urea", qty_min_mt: 14000, qty_max_mt: 16000,
      load_zone: "W.MED", load_country: "Algeria", load_port_name: "Mostaganem",
      disch_port_name: "Gemlik", disch_zone: "E.MED", laycan_from: "2026-07-15", origin: "live" },
  );
  ok(m?.band === "Strong" && m.score >= 100, `perfect geo match → Strong (${m?.score})`);
  const far = scoreCargoForVessel(
    { dwt_grain: 17000, open_zone: "W.MED", dest_zones: ["B.SEA"] },
    { ref: "CM-2", commodity_name: "coal", qty_min_mt: 15000, qty_max_mt: 16000,
      load_zone: "F.EAST", load_country: null, load_port_name: null,
      disch_port_name: null, disch_zone: "F.EAST", laycan_from: null, origin: "live" },
  );
  ok((far?.band ?? "none") !== "Strong", "right size but wrong geography → not Strong");
  // queued open position as a candidate for a cargo
  const qv = scoreVesselForCargo(
    { qty_min_mt: 14000, qty_max_mt: 16000, load_zone: "C.MED" },
    { vessel_name: "Unnamed vessel (X)", dwt_grain: 17000, build_year: null, preferred_zones: null, open_zone: "W.MED", open_port: "Mostaganem", origin: "draft" },
  );
  ok(qv != null && qv.facts.join(" ").includes("open Mostaganem"), "queued position matches nearby cargo, fact shows open port");
}

// ── LLM-output sanitation (the garbled-extraction regression) ───────────────
{
  console.log("LLM-output sanitation:");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { normalizeVessel, imoFromText, dwtFromText, clip } = require("@/lib/sync/email/graph") as typeof import("@/lib/sync/email/graph");
  const srcText = "Hi\nOur vessel IMO 5857 is open at Mastagaon port Algeria 17k dwt bulk Cariier . Let me know If you have any prompt cargo\nWe need cargo for Black Sea or turkey";
  // the EXACT garbage the model produced: a slice of the message inside vessel_type
  const garbled = normalizeVessel({
    vessel_type: "Bulk Carrier2026-07-09T22:33:38+00:00 bulk Cariier . Let me know If you have any prompt cargo\nWe need cargo for Black Sea or turkey",
    dwt: null, imo: null,
  }, srcText);
  ok(garbled.vessel_type === "Bulk Carrier", "garbled type → normalized 'Bulk Carrier'");
  ok(garbled.dwt === 17000, `DWT recovered from text by regex (${garbled.dwt})`);
  ok(garbled.imo === null, "4-digit 'IMO 5857' rejected (not a valid IMO)");
  ok(imoFromText("MV X IMO 9345789 open") === "9345789", "7-digit IMO recovered from text");
  ok(imoFromText("IMO: 934578") === "934578", "6-digit tolerated (flagged later)");
  ok(dwtFromText("about 17,000 dwt") === 17000, "'17,000 dwt' parsed");
  ok(dwtFromText("dwt 28500") === 28500, "'dwt 28500' parsed");
  ok(dwtFromText("no size stated") === null, "no dwt → null");
  ok(clip("  hello   world  ", 40) === "hello world", "clip collapses whitespace");
  ok(clip("x".repeat(80), 40) === null, "overlong garbage dropped");
  const clean = normalizeVessel({ vessel_name: "MV Aurora", vessel_type: "bulk carrier", dwt: 17000, imo: "9345789" }, srcText);
  ok(clean.vessel_name === "MV Aurora" && clean.imo === "9345789" && clean.dwt === 17000, "clean records pass through unchanged");
}

// ── rich vessel summary (posting date, open position, direction) ────────────
{
  console.log("vessel summary richness:");
  const v: VesselRecord = {
    vessel_type: "Bulk Carrier", dwt: 17000,
    open_port: "Mostaganem", open_country: "Algeria", open_zone: "W.MED",
    direction: "Black Sea or Turkey", dest_zones: ["B.SEA", "E.MED"],
    __src: { from: "x", subject: "s", date: "2026-07-09T22:00:00Z", text: "t", channel: "whatsapp" },
  };
  const s = vesselSummary(v, 0, 1);
  ok(s.includes("Mostaganem, Algeria (W.MED)"), "open position with zone in summary");
  ok(s.includes("Black Sea or Turkey"), "direction in summary");
  ok(s.includes("2026-07-09"), "posting date in summary");
  ok(s.includes("17,000 MT"), "dwt formatted");
}

// ── WA- provisional refs ────────────────────────────────────────────────────
{
  console.log("WA- provisional refs:");
  const sheets = recordsToSheets(
    [{ cargo_type: "Dry Bulk", commodity: "urea", qty_min_mt: 5000, qty_max_mt: 5000, load_port: "Adabiya" }],
    [], { refPrefix: "WA" },
  );
  const ref = String(sheets[0].rows[0].REF);
  ok(/^WA-[0-9A-F]{8}$/.test(ref), `WA- ref minted (${ref})`);
  ok(PROVISIONAL_REF_RE.test(ref), "WA- ref recognised as provisional");
  const again = recordsToSheets(
    [{ cargo_type: "Dry Bulk", commodity: "urea", qty_min_mt: 5000, qty_max_mt: 5000, load_port: "Adabiya" }],
    [], { refPrefix: "WA" },
  );
  ok(String(again[0].rows[0].REF) === ref, "deterministic (idempotent re-sync)");
  const email = recordsToSheets(
    [{ cargo_type: "Dry Bulk", commodity: "urea", qty_min_mt: 5000, qty_max_mt: 5000, load_port: "Adabiya" }],
    [],
  );
  ok(String(email[0].rows[0].REF).startsWith("EM-"), "email default prefix unchanged");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
