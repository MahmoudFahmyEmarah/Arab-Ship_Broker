// asb/detail-panel.jsx, sliding detail panel for cargo + vessel
// Triggered by card selection. Header has back / Edit / ✕.
// Body is scrollable. Quick edits inline (display only here).

// ── Illustrative photo hero ────────────────────────────────────
// Real operational photography, chosen by commodity / vessel so the panel
// feels grounded. Captioned "illustrative" — it is NOT the specific listed
// asset, so we never imply we hold a photo of the actual ship/parcel.
function dpCargoHero(c) {
  const s = ((c.commodity || "") + " " + (c.cargo || "")).toLowerCase();
  if (/ore|pellet|fines|iron|concentrate/.test(s))
    return { src: "assets/photos/ironore-pellet-w.jpg", cap: "Iron ore pellets" };
  if (/coal|coke|petcoke|clinker|cement|gypsum/.test(s))
    return { src: "assets/photos/discharge-night-w.jpg", cap: "Night discharge" };
  return { src: "assets/photos/grab-discharge-dawn-w.jpg", cap: "Dry bulk operations" };
}
function dpVesselHero(v) {
  const lastDigit = parseInt(String(v.imo || "0").slice(-1), 10) || 0;
  return lastDigit % 2 === 1
    ? { src: "assets/photos/bulker-night-w.jpg", cap: "Bulk carrier" }
    : { src: "assets/photos/deck-daysea-w.jpg", cap: "Laden passage" };
}
window.DetailHero = function DetailHero({ src, cap }) {
  return (
    <div className="dp-hero">
      <img className="dp-hero__img" src={src} alt="" loading="lazy" />
      <span className="dp-hero__scrim" />
      <span className="dp-hero__cap">{cap} · illustrative</span>
    </div>
  );
};

// ── CargoDetailPanel ────────────────────────────────────────────────────
window.CargoDetailPanel = function CargoDetailPanel({ cargo, onClose }) {
  if (!cargo) return null;
  const sfTip = ruleSF(cargo.sf, cargo.cargo);
  const laycanTip = ruleLaycan(cargo.laycanDays);
  const rateTip = ruleRate(cargo.loadRate, cargo.qty?.max);
  const freightTip = ruleFreight(cargo.freightIdea);
  const routeTip = ruleRoute(cargo.route.polZone, cargo.route.podZone);
  const imsbcTip = ruleIMSBC(cargo.imsbcGroup, cargo.cargo);
  const co = window.ASB_cargoOrg ? window.ASB_cargoOrg(cargo) : null;

  return (
    <div className="detail-panel">
      <header>
        <div className="row-sb" style={{ marginBottom: 4 }}>
          <button className="back" onClick={onClose}>
            <IconBack size={14} /> {cargo.cargo} · <span className="mono" style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>{cargo.refId}</span>
          </button>
          <div className="row" style={{ gap: 4 }}>
            <button className="asb-btn primary">Full edit →</button>
            <button className="asb-btn ghost" onClick={onClose} style={{ padding: "5px 8px" }}>
              <IconClose size={14} />
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className={`asb-badge ${cargo.scope}`}>{cargo.scope.toUpperCase()}</span>
          <span className="asb-badge neutral">{cargo.type === "Dry Bulk" ? "DRY BULK" : "BREAK BULK"}</span>
          <span className="asb-badge neutral">{cargo.nature}</span>
        </div>
      </header>

      <div className="body">
        <DetailHero {...dpCargoHero(cargo)} />
        <div className="section">
          <h4>Route</h4>
          <div className="grid-2">
            <FieldRow label="Load port" value={`${cargo.route.polName} · ${cargo.route.polCode}`} />
            <FieldRow label="Discharge port" value={`${cargo.route.podName} · ${cargo.route.podCode || ""}`} />
            <FieldRow label="Zone direction" value={`${cargo.route.polZone} → ${cargo.route.podZone}`} tip={routeTip} />
          </div>
        </div>

        <div className="section">
          <h4>Specifications</h4>
          <div className="grid-2">
            <FieldRow label="Commodity" value={cargo.commodity} />
            <FieldRow label="IMSBC group" value={`Group ${cargo.imsbcGroup}`} tip={imsbcTip} />
            <FieldRow label="Quantity" value={`${cargo.qtyMt} MT`} />
            <FieldRow label="Volume (auto)" value={`${cargo.vol} CBM`} />
            <FieldRow label="Stowage SF" value={`${cargo.sf} m³/t`} tip={sfTip} />
          </div>
        </div>

        <div className="section">
          <h4>Commercial terms</h4>
          <div className="grid-2">
            <FieldRow label="Laycan from" value={cargo.laycanFrom} />
            <FieldRow label="Laycan to" value={cargo.laycanTo} tip={laycanTip} />
            <FieldRow label="Load terms" value={cargo.loadTerms} />
            <FieldRow label="Load rate" value={`${cargo.loadRate.toLocaleString()} MT/d`} tip={rateTip} />
            <FieldRow label="Discharge rate" value={`${cargo.dischRate.toLocaleString()} MT/d`} />
            <FieldRow label="Freight idea" value={`$${cargo.freightIdea}/MT`} valueClass="blue" tip={freightTip} />
            <FieldRow label="Commission" value={`${cargo.commission}%`} tip={ruleCommission(cargo.commission)} />
            <FieldRow label="Demurrage" value={`$${cargo.demurrage.toLocaleString()}/d`} />
          </div>
        </div>

        <div className="section">
          <h4>Vessel requirements</h4>
          <div className="grid-2">
            <FieldRow label="Geared" value="No, shore gear acceptable" />
            <FieldRow label="Max age" value="25 yrs" />
            <FieldRow label="Max LOA" value="160 m" />
            <FieldRow label="Max draft" value="10.5 m" />
            <FieldRow label="Grain certified" value="Required" />
            <FieldRow label="DG certified" value="Not required" />
          </div>
        </div>

        {co && (
          <div className="section">
            <h4>Posted by</h4>
            <div className="grid-2">
              <FieldRow label="Company" value={`${co.org.name} · ${window.ASB_TYPE_LABEL[co.org.type]}`} valueClass="blue" />
              <FieldRow label="Country" value={co.org.country} />
              <FieldRow label="Handled by" value={co.handler.name} />
              <FieldRow label="Subscription" value={co.org.tier} />
              <FieldRow label="Desk contact" value={co.org.desk.name} />
              <FieldRow label="Desk email" value={co.org.desk.email} />
              <FieldRow label="Desk phone" value={co.org.desk.phone} />
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
              Enquiries route to the company desk, flagged “handled by {co.handler.name}”. Individual direct lines are never shown.
            </div>
          </div>
        )}

        <div className="section">
          <h4>Matches</h4>
          <div style={{ background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)", borderRadius: "var(--r-chip)", padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 500, color: "var(--asb-blue)", fontVariantNumeric: "tabular-nums" }}>{cargo.matches}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-navy)" }}>vessel matches found</div>
              <div style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>via Arab ShipBroker review</div>
            </div>
            <a style={{ fontSize: 11, color: "var(--asb-blue)" }}>View matches →</a>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: "10px 12px", background: "var(--asb-gray-50)", borderRadius: 3, fontSize: 10, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
          🔒 Your data is encrypted end-to-end. Visible only to Arab ShipBroker until your listing is approved.
        </div>
      </div>
    </div>
  );
};

// ── VesselDetailPanel ───────────────────────────────────────────────────
window.VesselDetailPanel = function VesselDetailPanel({ vessel, onClose }) {
  if (!vessel) return null;
  const ageTip = ruleAge(vessel.age);
  const vlsfoTip = ruleFuelVLSFO(vessel.fuel.vlsfoSea, vessel.dwt);
  const lsmgoTip = ruleFuelLSMGO(vessel.fuel.lsmgoSea);
  const openDateTip = ruleOpenDate(vessel.openDateDays);
  const vo = window.ASB_vesselOrg ? window.ASB_vesselOrg(vessel) : null;

  return (
    <div className="detail-panel">
      <header>
        <div className="row-sb" style={{ marginBottom: 4 }}>
          <button className="back" onClick={onClose}>
            <IconBack size={14} /> {vessel.name} · <span className="mono" style={{ fontSize: 12, color: "var(--asb-gray-500)" }}>IMO {vessel.imo}</span>
          </button>
          <div className="row" style={{ gap: 4 }}>
            <button className="asb-btn primary">Edit vessel →</button>
            <button className="asb-btn ghost" onClick={onClose} style={{ padding: "5px 8px" }}>
              <IconClose size={14} />
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <span className="asb-badge open">{vessel.status.toUpperCase()}</span>
          <span className="asb-badge neutral">{vessel.type}</span>
          <span className="asb-badge neutral">{vessel.flag}</span>
          <span className="asb-badge neutral">Built {vessel.built} ({vessel.age} yrs)</span>
        </div>
      </header>

      <div className="body">
        <DetailHero {...dpVesselHero(vessel)} />
        <div className="section">
          <h4>Vessel particulars</h4>
          <div className="grid-2">
            <FieldRow label="DWT Grain" value={`${vessel.dwt} MT`} valueClass="blue" />
            <FieldRow label="DWT Bale" value={`${vessel.dwtBale} MT`} />
            <FieldRow label="Grain cap." value={`${vessel.grainCap} m³`} />
            <FieldRow label="LOA" value={vessel.loa} />
            <FieldRow label="Beam" value={vessel.beam} />
            <FieldRow label="Draft (Summer)" value={vessel.draft} />
            <FieldRow label="Flag" value={vessel.flag} />
          </div>
        </div>

        <div className="section">
          <h4>Certifications & Equipment</h4>
          <div className="grid-2">
            <FieldRow label="Geared" value={vessel.geared ? "Yes, 4 × 30 MT cranes" : "No, shore gear"} />
            <FieldRow label="Grabs" value={vessel.geared ? "4 × 12 m³" : "—"} />
            <FieldRow label="Grain certified" value={vessel.grainCertified ? "Yes" : "No"} />
            <FieldRow label="DG certified" value={vessel.dgCertified ? "Yes" : "No"} />
            <FieldRow label="Scrubber" value="Hybrid, open loop" />
            <FieldRow label="EEXI / CII" value="Attained / Rating B" />
          </div>
        </div>

        <div className="section">
          <h4>Open positions · 1 active</h4>
          <div style={{
            background: "var(--asb-white)",
            border: "0.5px solid var(--asb-gray-200)",
            borderRadius: "var(--r-chip)",
            padding: 10,
          }}>
            <div className="row-sb" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{vessel.openPort} <span style={{ color: "var(--asb-gray-500)" }}>· {vessel.openPortZone}</span></span>
              <span className="asb-badge open">{vessel.status.toUpperCase()}</span>
            </div>
            <div className="grid-2" style={{ marginBottom: 6 }}>
              <FieldRow label="Open date" value={vessel.openDate} tip={openDateTip} />
              <FieldRow label="Date flex" value="± 3 days" />
              <FieldRow label="Last cargo" value="Wheat (bulk)" />
              <FieldRow label="Part cargo" value="Accepts" />
            </div>
            <a style={{ fontSize: 11, color: "var(--asb-blue)" }}>+ Post new position</a>
          </div>
        </div>

        <div className="section">
          <h4>Speed & fuel consumption</h4>
          <div className="grid-2">
            <FieldRow label="Service speed" value="13.5 kts" />
            <FieldRow label="Fuel type (main)" value="VLSFO" />
            <FieldRow label="ME · Sea" value={`${vessel.fuel.vlsfoSea} MT/d`} tip={vlsfoTip} />
            <FieldRow label="ME · Port" value={`${vessel.fuel.vlsfoPort} MT/d`} />
            <FieldRow label="LSMGO · Sea" value={`${vessel.fuel.lsmgoSea}${vessel.fuel.lsmgoSea !== "—" ? " MT/d" : ""}`} tip={lsmgoTip} />
            <FieldRow label="LSMGO · Port" value={`${vessel.fuel.lsmgoPort}${vessel.fuel.lsmgoPort !== "—" ? " MT/d" : ""}`} />
          </div>
        </div>

        <div className="section">
          <h4>Ownership</h4>
          <div className="grid-2">
            <FieldRow label="Owner" value={vo ? `${vo.owner.name} · ${vo.owner.country}` : "Operator A · UAE"} valueClass="blue" />
            <FieldRow label="Ship manager" value={vo ? `${vo.manager.name} · ${vo.manager.country}` : "V.Ships · CY"} />
            <FieldRow label="Owner IMO" value={vo && vo.owner.imo ? vo.owner.imo : "—"} />
            <FieldRow label="Fleet (owner)" value={vo && vo.owner.fleetTotal ? `${vo.owner.fleetTotal} vessels` : "—"} />
            <FieldRow label="Desk contact" value={vo ? vo.owner.desk.name : "Operator A"} />
            <FieldRow label="Charter status" value="Time Charter" />
            <FieldRow label="TC charterer" value="Withheld" />
            <FieldRow label="TC expiry" value="Q4 2026" />
          </div>
          {vo && (
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
              Registry: {vo.owner.address}. Enquiries route to {vo.owner.desk.email}.
            </div>
          )}
        </div>

        <div className="section">
          <h4>P&amp;I and trading</h4>
          <div className="grid-2">
            <FieldRow label="P&I Club" value="Skuld · IG member" />
            <FieldRow label="Coverage" value="Full" />
            <FieldRow label="War risk" value="On owner's terms" />
            <FieldRow label="Preferred zones" value="E.MED · R.SEA · AG" />
          </div>
        </div>

        <div className="section">
          <h4>Matches</h4>
          <div style={{ background: "var(--asb-blue-light)", border: "0.5px solid var(--asb-blue)", borderRadius: 3, padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 500, color: "var(--asb-blue)", fontVariantNumeric: "tabular-nums" }}>{vessel.matches}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-navy)" }}>cargo matches available</div>
              <div style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>in {vessel.openPortZone} and adjacent zones</div>
            </div>
            <a style={{ fontSize: 11, color: "var(--asb-blue)" }}>View matches →</a>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: "10px 12px", background: "var(--asb-gray-50)", borderRadius: 3, fontSize: 10, color: "var(--asb-gray-500)", lineHeight: 1.5 }}>
          🔒 Your vessel data is encrypted. Visible only to Arab ShipBroker until you publish a position.
        </div>
      </div>
    </div>
  );
};
