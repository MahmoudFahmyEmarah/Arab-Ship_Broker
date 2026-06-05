// asb/companies-data.js — Organization (company) directory for the org model.
//
// Grounds the "ownership lives on the company, not the person" model in real
// data: the owner/manager rows come from the Companies details reference
// (name · IMO · country · fleet · address · owns/manages). Charterer/broker
// orgs (the cargo-posting side) carry the same shape. Every org adds the
// model fields the backend needs: type · tier · desk contact · members.
//
// Exposes:
//   window.ASB_COMPANIES        — the directory
//   window.ASB_orgById(id)
//   window.ASB_activeOrg()      — the company the signed-in user posts as
//   window.ASB_currentMember()  — the signed-in person (one company per person)
//   window.ASB_cargoOrg(cargo)  — { org, handler } owning a cargo listing
//   window.ASB_TYPE_LABEL
(function () {
  window.ASB_TYPE_LABEL = {
    owner: "Owner", charterer: "Charterer", broker: "Broker",
    operator: "Operator", manager: "Ship Manager", other: "Other",
  };

  const companies = [
    // ── Charterer / broker side (posts cargo) ─────────────────────────────
    {
      id: "navigrains", name: "Navigrains", type: "charterer",
      country: "Greece", tier: "Tier 3", fleetTotal: null, imo: null,
      address: "1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece",
      desk: { name: "Chartering Desk", email: "chartering@navigrains.com", phone: "+30 210 452 7788" },
      members: [
        { name: "Karim Saleh", role: "broker", current: true },
        { name: "Eleni Pappas", role: "admin" },
        { name: "Omar Farouk", role: "broker" },
      ],
    },
    {
      id: "satirbroke", name: "Satirbroke", type: "broker",
      country: "Turkey", tier: "Tier 2", fleetTotal: null, imo: null,
      address: "Kemankeş Karamustafa Paşa, Rıhtım Cd. 28, 34425 Beyoğlu, İstanbul",
      desk: { name: "Dry Cargo Desk", email: "drycargo@satirbroke.com", phone: "+90 212 243 1190" },
      members: [
        { name: "Deniz Aktaş", role: "admin" },
        { name: "Mert Yılmaz", role: "broker" },
      ],
    },
    {
      id: "medshipping", name: "Mediterranean Shipping Services", type: "charterer",
      country: "Egypt", tier: "Tier 3", fleetTotal: null, imo: null,
      address: "20 Mahmoud Hamdy Street, Alexandria 21514, Egypt",
      desk: { name: "Operations Desk", email: "ops@medshipservices.com", phone: "+20 3 487 6620" },
      members: [
        { name: "Yasmine Adel", role: "admin" },
        { name: "Hany Mansour", role: "broker" },
      ],
    },
    {
      id: "gulfsea", name: "Gulf Sea Brokers", type: "broker",
      country: "UAE", tier: "Tier 4", fleetTotal: null, imo: null,
      address: "Unit 801, Bays Tower, Business Bay, Dubai, UAE",
      desk: { name: "Chartering Desk", email: "desk@gulfseabrokers.ae", phone: "+971 4 551 2030" },
      members: [
        { name: "Rashid Al-Marri", role: "admin" },
        { name: "Sana Qureshi", role: "broker" },
      ],
    },

    // ── Owner / manager side (real reference rows) ────────────────────────
    {
      id: "orientseas", name: "Orient Seas Ltd Co", type: "owner",
      country: "Saudi Arabia", tier: "Tier 2", imo: "6285232", fleetTotal: 5,
      address: "6th Floor, Al Falih Building, 2491 Taweriq, Al-Saddad District, Jeddah, Saudi Arabia",
      desk: { name: "Commercial Desk", email: "chartering@orientseas.com.sa", phone: "+966 12 690 4411" },
      members: [
        { name: "Faisal Al-Harbi", role: "admin" },
        { name: "Tariq Nasser", role: "broker" },
      ],
    },
    {
      id: "thalatta", name: "Thalatta Shipping Management", type: "manager",
      country: "Greece", tier: "Tier 2", imo: "0067951", fleetTotal: 5,
      address: "Akti Miaouli 33, 185 35 Piraeus, Greece",
      desk: { name: "Operations Desk", email: "ops@thalatta-mgmt.gr", phone: "+30 210 429 5500" },
      members: [{ name: "Nikos Andreou", role: "admin" }],
    },
    {
      id: "suezship", name: "Suez Ship Management", type: "manager",
      country: "Egypt", tier: "Tier 1", imo: null, fleetTotal: 4,
      address: "Shop 1, 359, 23rd July Street, Suez 35923, Egypt",
      desk: { name: "Operations", email: "ops@suezship.com", phone: "+20 62 319 0042" },
      members: [{ name: "Ahmed Sabry", role: "admin" }],
    },
    {
      id: "gmzhellas", name: "GMZ Ship Management Co Hellas", type: "manager",
      country: "Greece", tier: "Tier 2", imo: null, fleetTotal: 2,
      address: "1 Charilaou Trikoupi Street, 185 36, Piraeus, Greece",
      desk: { name: "Commercial", email: "chartering@gmz-hellas.gr", phone: "+30 210 411 8800" },
      members: [{ name: "Georgios Mazis", role: "admin" }],
    },
    {
      id: "abkshipping", name: "ABK Shipping Co", type: "owner",
      country: "Lebanon", tier: "Tier 1", imo: "5901913", fleetTotal: 1,
      address: "C/O Cedar Marine Services SAL, 3rd Floor, Sofi Plaza, Achier el-Daya Street, Tripoli, Lebanon",
      desk: { name: "Owner's Desk", email: "chartering@abkshipping.com", phone: "+961 6 433 210" },
      members: [{ name: "Bilal Khoury", role: "admin" }],
    },
    {
      id: "ariazworld", name: "Ariaz World Wide Shipping Corp", type: "manager",
      country: "UAE", tier: "Tier 2", imo: null, fleetTotal: 1,
      address: "Unit 801, Bays Tower, Business Bay, Dubai, UAE",
      desk: { name: "Operations Desk", email: "ops@ariaz-shipping.ae", phone: "+971 4 363 5521" },
      members: [{ name: "Imran Sheikh", role: "admin" }],
    },
    {
      id: "culines", name: "China United Lines Ltd", type: "manager",
      country: "China", tier: "Tier 3", imo: null, fleetTotal: 1,
      address: "Building 12, 706 Wuxing Lu, Pudong Xinqu, Shanghai 201204, China",
      desk: { name: "Chartering", email: "chartering@culines.com", phone: "+86 21 5836 9000" },
      members: [{ name: "Li Wen", role: "admin" }],
    },
    {
      id: "denizid", name: "Deniz ID Maritime Ltd", type: "owner",
      country: "Turkey", tier: "Tier 1", imo: null, fleetTotal: 1,
      address: "C/O Overseas Marine Ltd, Vatan Caddesi, Merkez Mah, 12/13, Mezitli, Mersin, Turkey",
      desk: { name: "Owner's Desk", email: "ops@denizid.com.tr", phone: "+90 324 357 1188" },
      members: [{ name: "Can Demir", role: "admin" }],
    },
  ];

  window.ASB_COMPANIES = companies;
  window.ASB_orgById = (id) => companies.find((c) => c.id === id) || null;

  // The signed-in user posts as exactly one company (one company per person).
  window.ASB_ACTIVE_ORG_ID = "navigrains";
  window.ASB_activeOrg = () => window.ASB_orgById(window.ASB_ACTIVE_ORG_ID);
  window.ASB_currentMember = () => {
    const o = window.ASB_activeOrg();
    return (o.members.find((m) => m.current) || o.members[0]);
  };

  // Deterministic cargo → owning charterer/broker org + the person handling it.
  const cargoOrgIds = ["navigrains", "satirbroke", "medshipping", "gulfsea"];
  window.ASB_cargoOrg = function (cargo) {
    const key = (cargo && (cargo.refId || cargo.ref || cargo.cargo)) || "";
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const org = window.ASB_orgById(cargoOrgIds[h % cargoOrgIds.length]);
    const handler = org.members[h % org.members.length];
    return { org, handler };
  };

  // Deterministic vessel → owning company + ship manager (the registry side).
  const ownerIds = ["orientseas", "abkshipping", "denizid"];
  const managerIds = ["thalatta", "suezship", "gmzhellas", "ariazworld", "culines"];
  window.ASB_vesselOrg = function (vessel) {
    const key = String((vessel && (vessel.imo || vessel.name)) || "");
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const owner = window.ASB_orgById(ownerIds[h % ownerIds.length]);
    const manager = window.ASB_orgById(managerIds[(h >> 3) % managerIds.length]);
    return { owner, manager };
  };
})();
