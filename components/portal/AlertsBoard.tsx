"use client";

// My Alerts — standing match-alert triggers + recent notifications. On-brand
// port of the design's alerts surface (asb/alerts.jsx), tokens-styled.
import * as React from "react";
import { IconBell, IconPlus } from "./icons";

interface Trigger {
  id: string;
  name: string;
  criteria: string;
  channel: string;
  on: boolean;
  matches: number;
}

const SEED: Trigger[] = [
  { id: "a1", name: "Grain ex Black Sea", criteria: "Cargo · B.SEA → R.SEA · Dry Bulk · ≤ 35k MT", channel: "Email · Immediate", on: true, matches: 4 },
  { id: "a2", name: "Handysize open E.Med", criteria: "Vessel · E.MED · 10–35k DWT · Geared", channel: "Email · Daily", on: true, matches: 6 },
  { id: "a3", name: "Phosphate to India", criteria: "Cargo · R.SEA → A.SEA · laycan ≤ 14d", channel: "In-app", on: false, matches: 2 },
];

export function AlertsBoard() {
  const [triggers, setTriggers] = React.useState(SEED);
  const toggle = (id: string) => setTriggers((t) => t.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
  const active = triggers.filter((t) => t.on).length;
  const totalMatches = triggers.reduce((a, t) => a + (t.on ? t.matches : 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
        <div className="row-sb">
          <div>
            <h1 className="page-title">My Alerts</h1>
            <div className="eyebrow" style={{ marginTop: 2 }}>{active} active triggers · {totalMatches} live matches</div>
          </div>
          <button className="asb-btn primary" disabled aria-disabled title="The alert builder ships with the notifications engine. Coming soon."
            style={{ opacity: 0.55, cursor: "not-allowed" }}>
            <IconPlus size={12} color="#fff" /> New alert <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>SOON</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Standing alert triggers</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 10 }}>
          {triggers.map((t) => (
            <div key={t.id} className="asb-card" style={{ cursor: "default" }}>
              <div className="row-sb" style={{ marginBottom: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: "var(--asb-navy)" }}>
                  <IconBell size={14} color="var(--asb-blue)" /> {t.name}
                </span>
                <span className={`toggle ${t.on ? "is-on" : ""}`} onClick={() => toggle(t.id)} style={{ cursor: "pointer" }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--asb-gray-700)", marginBottom: 6 }}>{t.criteria}</div>
              <div className="row-sb" style={{ paddingTop: 6, borderTop: "var(--bd)" }}>
                <span style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>{t.channel}</span>
                <span className={`asb-badge ${t.on ? "blue" : "neutral"}`}>{t.on ? `${t.matches} matches` : "Paused"}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Recent match notifications</div>
        <div className="asb-panel">
          <div className="panel-body" style={{ padding: 0 }}>
            {[
              ["Wheat (Bulk) · CK-001 → MV TRADE WINDS", "E.MED → R.SEA · TCE $8.4k/d", "2h ago"],
              ["Phosphate Rock · CK-003 → MV SEA NAVIGATOR", "R.SEA → A.SEA · TCE $7.1k/d", "5h ago"],
              ["Handysize open · MV BALTIC STAR", "Constanta · 35k DWT", "Yesterday"],
            ].map(([title, sub, when]) => (
              <div key={title} className="dash-row" style={{ paddingRight: 90 }}>
                <div className="dash-row__r1"><span className="dash-row__name">{title}</span></div>
                <div className="dash-row__r3"><span>{sub}</span></div>
                <span className="dash-row__badge" style={{ background: "transparent", color: "var(--asb-gray-500)", minWidth: 0 }}>{when}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
