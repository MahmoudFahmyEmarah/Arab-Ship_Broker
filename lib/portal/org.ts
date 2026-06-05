// Organization (company) model — client helpers.
//
// Ports asb/companies-data.js into typed TS. The directory + the cargoOrg/
// vesselOrg resolvers are DEMO STUBS (deterministic hash, matching the prototype)
// so the org UI — Posting-as chip, Review "Posted by", detail-panel Ownership —
// renders real-looking content NOW. Swap to the DB once listings carry
// owner_org_id (organizations + organization_members, migration …000800):
// replace orgForCargo/orgForVessel with the owner_org_id join + fn_my_org_ids().
//
// Member NAMES are generic placeholders (Charterer 1, Operations 1, …) — real
// people aren't known yet; swap in real members once they sign up. Companies are
// real (Companies_details.xlsx); the full registry is seeded by migration …000840.

export type OrgType = "owner" | "charterer" | "broker" | "operator" | "manager" | "other";

export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  owner: "Owner", charterer: "Charterer", broker: "Broker",
  operator: "Operator", manager: "Ship Manager", other: "Other",
};

export interface OrgMember { name: string; role: "admin" | "broker" | "viewer"; current?: boolean }
export interface Org {
  id: string; name: string; type: OrgType; country: string; tier: string;
  imo?: string | null; fleetTotal?: number | null; address: string;
  desk: { name: string; email: string; phone: string };
  members: OrgMember[];
}

export const ORGS: Org[] = [
  { id: "navigrains", name: "Navigrains", type: "charterer", country: "Greece", tier: "Tier 3", address: "1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece", desk: { name: "Chartering Desk", email: "chartering@navigrains.com", phone: "+30 210 452 7788" }, members: [{ name: "Charterer 1", role: "broker", current: true }, { name: "Charterer 2", role: "admin" }, { name: "Charterer 3", role: "broker" }] },
  { id: "satirbroke", name: "Satirbroke", type: "broker", country: "Turkey", tier: "Tier 2", address: "Kemankeş Karamustafa Paşa, Rıhtım Cd. 28, 34425 Beyoğlu, İstanbul", desk: { name: "Dry Cargo Desk", email: "drycargo@satirbroke.com", phone: "+90 212 243 1190" }, members: [{ name: "Broker 1", role: "admin" }, { name: "Broker 2", role: "broker" }] },
  { id: "medshipping", name: "Mediterranean Shipping Services", type: "charterer", country: "Egypt", tier: "Tier 3", address: "20 Mahmoud Hamdy Street, Alexandria 21514, Egypt", desk: { name: "Operations Desk", email: "ops@medshipservices.com", phone: "+20 3 487 6620" }, members: [{ name: "Charterer 1", role: "admin" }, { name: "Charterer 2", role: "broker" }] },
  { id: "gulfsea", name: "Gulf Sea Brokers", type: "broker", country: "UAE", tier: "Tier 4", address: "Unit 801, Bays Tower, Business Bay, Dubai, UAE", desk: { name: "Chartering Desk", email: "desk@gulfseabrokers.ae", phone: "+971 4 551 2030" }, members: [{ name: "Broker 1", role: "admin" }, { name: "Broker 2", role: "broker" }] },
  { id: "orientseas", name: "Orient Seas Ltd Co", type: "owner", country: "Saudi Arabia", tier: "Tier 2", imo: "6285232", fleetTotal: 5, address: "6th Floor, Al Falih Building, 2491 Taweriq, Al-Saddad District, Jeddah, Saudi Arabia", desk: { name: "Commercial Desk", email: "chartering@orientseas.com.sa", phone: "+966 12 690 4411" }, members: [{ name: "Owner Rep 1", role: "admin" }, { name: "Owner Rep 2", role: "broker" }] },
  { id: "thalatta", name: "Thalatta Shipping Management", type: "manager", country: "Greece", tier: "Tier 2", imo: "0067951", fleetTotal: 5, address: "Akti Miaouli 33, 185 35 Piraeus, Greece", desk: { name: "Operations Desk", email: "ops@thalatta-mgmt.gr", phone: "+30 210 429 5500" }, members: [{ name: "Operations 1", role: "admin" }] },
  { id: "suezship", name: "Suez Ship Management", type: "manager", country: "Egypt", tier: "Tier 1", fleetTotal: 4, address: "Shop 1, 359, 23rd July Street, Suez 35923, Egypt", desk: { name: "Operations", email: "ops@suezship.com", phone: "+20 62 319 0042" }, members: [{ name: "Operations 1", role: "admin" }] },
  { id: "abkshipping", name: "ABK Shipping Co", type: "owner", country: "Lebanon", tier: "Tier 1", imo: "5901913", fleetTotal: 1, address: "C/O Cedar Marine Services SAL, Tripoli, Lebanon", desk: { name: "Owner's Desk", email: "chartering@abkshipping.com", phone: "+961 6 433 210" }, members: [{ name: "Owner Rep 1", role: "admin" }] },
  { id: "denizid", name: "Deniz ID Maritime Ltd", type: "owner", country: "Turkey", tier: "Tier 1", fleetTotal: 1, address: "C/O Overseas Marine Ltd, Mezitli, Mersin, Turkey", desk: { name: "Owner's Desk", email: "ops@denizid.com.tr", phone: "+90 324 357 1188" }, members: [{ name: "Owner Rep 1", role: "admin" }] },
];

const byId = (id: string) => ORGS.find((o) => o.id === id) ?? null;

// The signed-in user posts as exactly one company (one company per person).
// DEMO: fixed to Navigrains until membership is read from organization_members.
export const ACTIVE_ORG_ID = "navigrains";
export const activeOrg = (): Org => byId(ACTIVE_ORG_ID)!;
export const currentMember = (): OrgMember => {
  const o = activeOrg();
  return o.members.find((m) => m.current) ?? o.members[0];
};

function hash(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

const CARGO_ORG_IDS = ["navigrains", "satirbroke", "medshipping", "gulfsea"];
/** DEMO: deterministic cargo → owning charterer/broker org + the handler. */
export function orgForCargo(key: string): { org: Org; handler: OrgMember } {
  const h = hash(key || "");
  const org = byId(CARGO_ORG_IDS[h % CARGO_ORG_IDS.length])!;
  return { org, handler: org.members[h % org.members.length] };
}

const OWNER_IDS = ["orientseas", "abkshipping", "denizid"];
const MANAGER_IDS = ["thalatta", "suezship"];
/**
 * @deprecated SUPERSEDED — the vessel Ownership card now reads the real
 * owner_org_id / manager_org_id link via the firewalled v_vessel_detail
 * (migration …000870 + fetchVesselOwnership). Kept only for reference.
 * DEMO: deterministic vessel → registry owner + ship manager.
 */
export function orgForVessel(key: string): { owner: Org; manager: Org } {
  const h = hash(String(key || ""));
  return { owner: byId(OWNER_IDS[h % OWNER_IDS.length])!, manager: byId(MANAGER_IDS[(h >> 3) % MANAGER_IDS.length])! };
}
