// Email + LLM source — shared types. The classifier boundary is an interface so
// the LangGraph graph can be driven by the real LangChain model in production
// and by a canned mock in tests (no network).

export interface EmailMsg {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  text: string;
}

// A compact snapshot of the source message (email or WhatsApp), carried on each
// extracted record so the Review "Source" drawer can show the original beside
// the parse — and, for WhatsApp, the contact card + teaser linkage.
export interface EmailSource {
  from: string;
  subject: string;
  date: string | null;
  text: string;
  channel?: "email" | "whatsapp";
  name?: string | null;   // contact display name (whatsapp)
  msgId?: string | null;  // whatsapp_message.id (teaser linkage)
}

export interface CargoRecord {
  ref?: string | null;
  cargo_type?: "Dry Bulk" | "Break Bulk" | null;
  commodity?: string | null;
  qty_min_mt?: number | null;
  qty_max_mt?: number | null;
  load_port?: string | null;
  load_zone?: string | null;
  disch_port?: string | null;
  disch_zone?: string | null;
  laycan_from?: string | null;
  laycan_to?: string | null;
  freight_idea?: number | null;
  commission_pct?: number | null;
  load_rate?: string | null;
  disch_rate?: string | null;
  laytime_structure?: string | null;
  load_terms?: string | null;
  broker?: string | null;
  notes?: string | null;
  asb_regime?: string | null; // GRAIN | IMSBC | CSS | MULTI-PARCEL | UNMAPPED
  __src?: EmailSource;        // source email (attached in the graph, not from the LLM)

}

export interface VesselRecord {
  imo?: string | null;
  vessel_name?: string | null;
  vessel_type?: string | null;
  dwt?: number | null;
  flag?: string | null;
  built?: number | null;
  // open-position intelligence (drives location-aware matching)
  open_port?: string | null;      // where she's open, e.g. "Mostaganem"
  open_country?: string | null;   // e.g. "Algeria"
  open_zone?: string | null;      // zone code, e.g. "W.MED"
  direction?: string | null;      // free text, e.g. "Black Sea or Turkey"
  dest_zones?: string[] | null;   // zone codes for the direction, e.g. ["B.SEA","E.MED"]
  __src?: EmailSource;
}

export type EmailCategory = "cargo" | "vessel" | "mixed" | "irrelevant";

export interface ClassifyResult {
  category: EmailCategory;
  reason: string;
  cargo: CargoRecord[];
  vessels: VesselRecord[];
}

// The LLM boundary — ONE call classifies a BATCH of emails together (relevance +
// cargo + vessel extraction), returning one result per input email in order.
// Batching many emails per call is far fewer round-trips than one call each.
export interface Classifier {
  classifyBatch(emails: EmailMsg[]): Promise<ClassifyResult[]>;
}

// Progress events streamed to the browser over SSE.
export type SyncEvent =
  | { type: "log"; msg: string }
  | { type: "done"; batchId: string; totals: { new: number; updated: number; unchanged: number; invalid: number; errors: number } }
  | { type: "empty"; message: string }
  | { type: "error"; error: string };
