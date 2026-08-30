// The production Classifier — ONE schema-constrained call per email returns the
// category plus every cargo and vessel record together. This is 3× fewer LLM
// round-trips than gating relevance / cargo / vessels separately, which is the
// single biggest speed win for the inbox sync.

import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Classifier, ClassifyResult, EmailMsg } from "./types";

const PER_EMAIL_CHARS = 6000; // cap each email's text inside a batch

const CargoItem = z.object({
  ref: z.string().nullable().optional().describe("broker reference if present, e.g. CM-123"),
  cargo_type: z.enum(["Dry Bulk", "Break Bulk"]).nullable().optional().describe("bulk = loose in holds; break bulk = bagged/bundled/palletised/unitised"),
  commodity: z.string().nullable().optional(),
  qty_min_mt: z.number().nullable().optional().describe("min quantity in metric tonnes, number only"),
  qty_max_mt: z.number().nullable().optional(),
  load_port: z.string().nullable().optional(),
  load_zone: z.string().nullable().optional().describe("zone code if known, e.g. B.SEA, AG, NCONT"),
  disch_port: z.string().nullable().optional(),
  disch_zone: z.string().nullable().optional(),
  laycan_from: z.string().nullable().optional().describe("ISO date YYYY-MM-DD, or 'SPOT'/'PPT' if prompt/spot"),
  laycan_to: z.string().nullable().optional().describe("ISO date YYYY-MM-DD"),
  freight_idea: z.number().nullable().optional().describe("freight idea in USD/MT, number only"),
  commission_pct: z.number().nullable().optional(),
  // Rates/laytime — NOT load terms. "8000/3000", "4000 SSHEX", "1500 MT/day" go here.
  load_rate: z.string().nullable().optional().describe("load rate as written, e.g. '4000 SSHEX' — NOT a term code"),
  disch_rate: z.string().nullable().optional().describe("discharge rate as written, e.g. '3000'"),
  laytime_structure: z.string().nullable().optional().describe("combined load/disch rate string, e.g. '8000 / 3000 SSHEX'"),
  // Only a real charter-terms code — leave null if the email only quotes rates.
  load_terms: z.enum(["FIO", "FIOT", "FIOST", "FIOS", "FIOS LSD", "Liner Terms", "FO", "FILO", "LIFO", "FLT"])
    .nullable().optional().describe("ONLY a charter-terms code; null if the email only gives rates"),
  asb_regime: z.enum(["GRAIN", "IMSBC", "CSS", "MULTI-PARCEL"]).nullable().optional()
    .describe("classify the commodity's regime; leave null only if you truly cannot tell"),
  broker: z.string().nullable().optional().describe("broker/desk name or email, if the sender identifies one"),
  notes: z.string().nullable().optional().describe("anything else: firm/indication, WOG, SF, options, per-clauses"),
});

const ZONE_CODES = [
  "B.SEA", "E.MED", "W.MED", "C.MED", "ADRIATIC", "R.SEA", "AG", "A.SEA",
  "WCAF", "ECAF", "NCONT", "CARIB", "F.EAST", "ECI", "WCI", "ECSA", "GLAKES",
] as const;

const VesselItem = z.object({
  imo: z.string().nullable().optional().describe("the vessel's IMO number AS WRITTEN — the digits after the word 'IMO' (typically 7 digits, but capture 6–8 digit values too; never invent one)"),
  vessel_name: z.string().nullable().optional(),
  vessel_type: z.string().nullable().optional(),
  dwt: z.number().nullable().optional().describe("deadweight in tonnes, number only ('17k' → 17000)"),
  grt: z.number().nullable().optional().describe("gross tonnage (GT/GRT), number only — key for port cost calculations"),
  nrt: z.number().nullable().optional().describe("net tonnage (NRT), number only"),
  flag: z.string().nullable().optional(),
  built: z.number().nullable().optional().describe("build year, 4-digit"),
  open_port: z.string().nullable().optional().describe("port where the vessel is/becomes open, e.g. 'Mostaganem'"),
  open_date: z.string().nullable().optional().describe("date the vessel is/becomes OPEN (availability date), ISO yyyy-mm-dd — from 'open 10-12 Aug' take the first day; null if not stated; never use the email's send date"),
  open_country: z.string().nullable().optional().describe("country of the open port, e.g. 'Algeria'"),
  open_zone: z.enum(ZONE_CODES).nullable().optional().describe("zone code of the open position (see ZONES glossary)"),
  direction: z.string().nullable().optional().describe("where she wants to go, as written, e.g. 'Black Sea or Turkey'"),
  dest_zones: z.array(z.enum(ZONE_CODES)).nullable().optional().describe("zone codes for the desired direction, e.g. Black Sea/Turkey → ['B.SEA','E.MED']"),
});

const BatchSchema = z.object({
  results: z.array(z.object({
    index: z.number().int().describe("0-based index of the email this result is for"),
    category: z.enum(["cargo", "vessel", "mixed", "irrelevant"])
      .describe("cargo = cargo orders/enquiries; vessel = open vessel positions; mixed = both; irrelevant = neither"),
    reason: z.string().describe("one short sentence"),
    cargo: z.array(CargoItem).describe("every distinct cargo order in THIS email; empty if none"),
    vessels: z.array(VesselItem).describe("every distinct open vessel position in THIS email; empty if none"),
  })).describe("exactly one result per input email, tagged with its index"),
});

function batchSysPrompt(count: number): string {
  const year = new Date().getFullYear();
  return [
    `You are given ${count} dry-bulk shipbroking email(s), each delimited by "=== EMAIL i ===" where i is a 0-based index.`,
    "For EACH email, in ONE pass: classify it (cargo / vessel / mixed / irrelevant) and extract EVERY distinct cargo order and vessel position.",
    "Return exactly one result object per email, tagged with its index i. Irrelevant email → empty arrays.",
    "",
    "FIELD RULES (follow exactly):",
    "• QUANTITY: always fill BOTH qty_min_mt and qty_max_mt (numbers, strip commas/'k'/'mts'). 'N +/- X%' → min=round(N*(1-X/100)), max=round(N*(1+X/100)); 'A/B' or 'A-B' → A and B; single figure → both equal.",
    `• LAYCAN: ISO YYYY-MM-DD, or 'SPOT'/'PPT' for prompt/spot. Day/month with no year → use ${year}.`,
    "• RATES vs TERMS — do NOT confuse them. Loading/discharge rates like '8000/3000', '4000 SSHEX', '1500 MT/day WWDSSHEX', '2000/1250' are RATES → put the load side in load_rate, the disch side in disch_rate, and the whole string in laytime_structure. load_terms is ONLY a charter-terms code (FIO, FIOST, FIOS, Liner Terms, …); if the email just quotes rates, leave load_terms null.",
    "• STATUS is an internal ASB market status and is NEVER stated in a circular — there is no status field to fill. Words like 'firm', 'firm cargo', 'indication', 'on subs' are commercial notes → put them in notes, never as a status/term.",
    "• cargo_type: bulk grain/minerals/loose = 'Dry Bulk'; bagged / big-bags / bundles / palletised / unitised / steel / logs = 'Break Bulk'.",
    "",
    "ZONES glossary (use these codes for load_zone/disch_zone/open_zone/dest_zones):",
    "• B.SEA Black Sea + Sea of Marmara (Ukraine, Russia BS coast, Romania, Bulgaria, Georgia, Turkish BS coast)",
    "• E.MED East Med (Turkey Med/Aegean coast, Greece, Cyprus, Levant, Egypt Med)",
    "• C.MED Central Med (Italy, Malta, Tunisia, Libya) · ADRIATIC (Adriatic sea coasts)",
    "• W.MED West Med (Spain Med, France Med, ALGERIA, MOROCCO Med)",
    "• R.SEA Red Sea (Egypt RS, Saudi RS, Sudan, Djibouti) · AG Arabian Gulf · A.SEA Arabian Sea (Aden, Oman, Pakistan)",
    "• NCONT North Continent + UK/Baltic + Atlantic France/Iberia · WCAF West Africa Atlantic (incl. Morocco Atlantic) · ECAF East Africa",
    "• WCI/ECI West/East Coast India · F.EAST Far East · CARIB Caribbean · ECSA East Coast South America · GLAKES Great Lakes",
    "A country like 'Turkey' spans zones → dest_zones lists all plausible ones (Turkey → ['E.MED','B.SEA']).",
    "",
    "ASB_REGIME — classify the commodity:",
    "• GRAIN: cereals & whole oilseeds/pulses in BULK — wheat, maize/corn, barley, oats, rye, rice, sorghum, peas/beans/pulses, whole soybeans/sunflower seeds/rapeseed/linseed.",
    "• IMSBC: minerals & processed goods — iron ore, bauxite, barite/barytes, limestone, dolomite, salt, gypsum, clay; fertilisers (urea, DAP, MAP, NPK, potash, phosphate); cement/clinker; coal; coke/petcoke/metcoke; and all meals/cakes/pellets/bran (soybean meal, sunmeal/sunflower meal, rapeseed meal, seed cake, olive cake/pomace/pulp, DDGS, alfalfa pellets, wheat bran).",
    "• CSS: bagged/break-bulk & steel/logs — bagged cargo, big bags, sugar in bags, steel (rebar, coils, billets, plates), logs, marble/granite blocks, general cargo, 'harmless cargo in bundles'.",
    "• MULTI-PARCEL: two or more different commodities in one enquiry (e.g. 'corn + wheat', 'cement + steel').",
    "",
    "WORKED EXAMPLES:",
    "• '8000 MT harmless cargo in bundles SF 1.1 1SPB Tangier/1SPB Alexandria, firm, 1000 MTS SSHEX bends' → {cargo_type:'Break Bulk', commodity:'harmless cargo in bundles', qty_min_mt:8000, qty_max_mt:8000, load_port:'Tangier', disch_port:'Alexandria', laytime_structure:'1000 MTS SSHEX bends', load_terms:null, asb_regime:'CSS', notes:'firm; SF 1.1'}",
    "• '25,000 mts +-10% wheat WOG Pivdennyi/1SB Egypt Med, 8000 SSHEX / 4000 SSHEX, 2.5%' → {cargo_type:'Dry Bulk', commodity:'wheat', qty_min_mt:22500, qty_max_mt:27500, load_port:'Pivdennyi', disch_port:'Egypt Med', load_rate:'8000 SSHEX', disch_rate:'4000 SSHEX', laytime_structure:'8000 SSHEX / 4000 SSHEX', load_terms:null, commission_pct:2.5, asb_regime:'GRAIN', notes:'WOG'}",
    "• '5,500 mts bagged urea ex ADABIYA / Dar Es Salaam or Mombasa 2000/1250' → {cargo_type:'Break Bulk', commodity:'bagged urea', qty_min_mt:5500, qty_max_mt:5500, load_port:'Adabiya', disch_port:'Dar Es Salaam or Mombasa', load_rate:'2000', disch_rate:'1250', laytime_structure:'2000/1250', load_terms:null, asb_regime:'IMSBC'}",
    "• 'Our vessel is open at Mostaganem port Algeria 17k dwt bulk carrier. We need cargo for Black Sea or Turkey' → vessel {vessel_name:null, vessel_type:'Bulk Carrier', dwt:17000, open_port:'Mostaganem', open_country:'Algeria', open_zone:'W.MED', direction:'Black Sea or Turkey', dest_zones:['B.SEA','E.MED']}",
    "",
    "Leave any field null when not stated — never invent values (but ALWAYS derive open_zone/dest_zones from named places using the ZONES glossary).",
  ].join("\n");
}

function emailBlock(e: EmailMsg, i: number): string {
  const body = `FROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${e.date ?? ""}\n\n${e.text}`.slice(0, PER_EMAIL_CHARS);
  return `=== EMAIL ${i} ===\n${body}`;
}

export class LangChainClassifier implements Classifier {
  constructor(private model: BaseChatModel) {}

  async classifyBatch(emails: EmailMsg[]): Promise<ClassifyResult[]> {
    if (emails.length === 0) return [];
    const m = this.model.withStructuredOutput(BatchSchema, { name: "classify_batch" });
    const body = emails.map((e, i) => emailBlock(e, i)).join("\n\n");
    const r = (await m.invoke(`${batchSysPrompt(emails.length)}\n\n${body}`)) as z.infer<typeof BatchSchema>;

    // Map results back by their declared index (robust to reordering / omissions).
    const out: ClassifyResult[] = emails.map(() => ({ category: "irrelevant", reason: "", cargo: [], vessels: [] }));
    for (const res of r.results ?? []) {
      if (Number.isInteger(res.index) && res.index >= 0 && res.index < emails.length) {
        out[res.index] = {
          category: res.category,
          reason: res.reason,
          cargo: (res.cargo ?? []) as ClassifyResult["cargo"],
          vessels: (res.vessels ?? []) as ClassifyResult["vessels"],
        };
      }
    }
    return out;
  }
}
