"use client";

// Vessel position check-in popup (Pre_Final §13), ported from the design's
// position-checkin.jsx. One tap to confirm the position on file, or a 4-field
// inline update (next port via the canonical ports search, ETA date/time,
// open date). Both paths stamp position_confirmed_at through the
// ownership-enforcing RPC. Shows once per session, ~1.4s after load, honoring
// the reminder frequency set in Settings (Every login / Daily / Weekly / Off).
import * as React from "react";
import { createPortal } from "react-dom";
import { Ship, Check, X } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { searchPorts } from "@/sdk/app/ports";
import { getDuePosition, submitCheckin, type DuePosition } from "@/lib/portal/position-checkin-actions";

const CHECKIN_KEY = "asbPosCheckinDone";
const FREQ_KEY = "asbPosCheckinFreq"; // every-login | daily | weekly | off
const LAST_KEY = "asbPosCheckinLast"; // ms timestamp of last confirm/update/snooze

export type CheckinFreq = "every-login" | "daily" | "weekly" | "off";

export function getCheckinFreq(): CheckinFreq {
  try {
    return (localStorage.getItem(FREQ_KEY) as CheckinFreq) || "every-login";
  } catch {
    return "every-login";
  }
}
export function setCheckinFreq(v: CheckinFreq) {
  try {
    localStorage.setItem(FREQ_KEY, v);
  } catch {}
}

// Is the check-in due, given the user's reminder setting?
function checkinDue(): boolean {
  const freq = getCheckinFreq();
  if (freq === "off") return false;
  try {
    if (sessionStorage.getItem(CHECKIN_KEY)) return false;
  } catch {}
  if (freq === "every-login") return true;
  let last = 0;
  try {
    last = parseInt(localStorage.getItem(LAST_KEY) || "0", 10) || 0;
  } catch {}
  const age = Date.now() - last;
  if (freq === "daily") return age > 24 * 3600 * 1000;
  if (freq === "weekly") return age > 7 * 24 * 3600 * 1000;
  return true;
}

function markDone() {
  try {
    sessionStorage.setItem(CHECKIN_KEY, "1");
  } catch {}
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()));
  } catch {}
}

// ── Settings row: reminder frequency control (Settings → Preferences) ──
// Shared source of truth with the popup (same keys), per the handoff.
export function PosCheckinFreqRow() {
  const [freq, setFreq] = React.useState<CheckinFreq>("every-login");
  React.useEffect(() => setFreq(getCheckinFreq()), []);
  const opts: { id: CheckinFreq; label: string }[] = [
    { id: "every-login", label: "Every login" },
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "off", label: "Off" },
  ];
  const pick = (id: CheckinFreq) => {
    setFreq(id);
    setCheckinFreq(id);
  };
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 5 }}>Reminder frequency</div>
      <div
        role="radiogroup"
        aria-label="Position check-in reminder frequency"
        style={{ display: "flex", gap: 0, border: "1px solid var(--asb-gray-200)", borderRadius: 8, overflow: "hidden" }}
      >
        {opts.map((o, i) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={freq === o.id}
            onClick={() => pick(o.id)}
            style={{
              flex: 1,
              padding: "7px 4px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11.5,
              fontWeight: 600,
              border: "none",
              borderLeft: i > 0 ? "1px solid var(--asb-gray-200)" : "none",
              background: freq === o.id ? "var(--asb-navy, #1B3A5C)" : "#fff",
              color: freq === o.id ? "#fff" : "var(--asb-gray-700)",
              transition: "background .12s ease, color .12s ease",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type PortHit = { locode: string; trade_name: string; country: string };

export function PositionCheckin() {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"ask" | "update" | "done">("ask");
  const [doneMsg, setDoneMsg] = React.useState("");
  const [vessel, setVessel] = React.useState<DuePosition | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // form state
  const [portQ, setPortQ] = React.useState("");
  const [port, setPort] = React.useState<PortHit | null>(null);
  const [showDrop, setShowDrop] = React.useState(false);
  const [results, setResults] = React.useState<PortHit[]>([]);
  const [etaDate, setEtaDate] = React.useState("");
  const [etaTime, setEtaTime] = React.useState("");
  const [openDate, setOpenDate] = React.useState("");

  // Open once per session, ~1.4s after the portal loads, respecting the
  // reminder frequency. (The prototype also waited for a welcome popup; the
  // production portal has none, so the delay alone applies.)
  React.useEffect(() => {
    if (!checkinDue()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getDuePosition().then((v) => {
        if (cancelled || !v) return;
        setVessel(v);
        setOpen(true);
      });
    }, 1400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // Live port search over the canonical ports table (same as Post Position).
  React.useEffect(() => {
    if (!showDrop || port || portQ.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchPorts(getSupabaseBrowserClient(), portQ)
        .then((rows) => setResults((rows as PortHit[]).slice(0, 6)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [portQ, showDrop, port]);

  if (!vessel || !open) return null;

  const close = () => {
    markDone();
    setOpen(false);
  };
  const finish = (msg: string) => {
    markDone();
    setDoneMsg(msg);
    setMode("done");
    setTimeout(() => setOpen(false), 1600);
  };

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    const res = await submitCheckin({ availabilityId: vessel.availabilityId });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "Could not confirm. Please try again.");
      return;
    }
    finish("Position confirmed. Thank you.");
  };

  const save = async () => {
    if (!port || !etaDate) return;
    setBusy(true);
    setErr(null);
    const res = await submitCheckin({
      availabilityId: vessel.availabilityId,
      etaPortLocode: port.locode,
      etaDate,
      etaTime: etaTime || undefined,
      openDate: openDate || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? "Could not save. Please try again.");
      return;
    }
    finish("Position updated. Thank you.");
  };

  const canSave = !!port && !!etaDate && !busy;
  const urgDot =
    vessel.urgency === "red" ? "var(--asb-red, #E24B4A)"
    : vessel.urgency === "amber" ? "var(--asb-amber, #EF9F27)"
    : "var(--asb-green, #97C459)";
  const onFileDate = vessel.openDate
    ? new Date(vessel.openDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "no date";

  return createPortal(
    <div className="asb-checkin-backdrop" onMouseDown={close} role="dialog" aria-modal="true" aria-label="Vessel position check-in">
      <div className="asb-checkin" onMouseDown={(e) => e.stopPropagation()}>
        <div className="asb-checkin__head">
          <span className="asb-checkin__chip" aria-hidden="true"><Ship size={17} /></span>
          <div>
            <div className="asb-checkin__eyebrow">Position check-in</div>
            <div className="asb-checkin__name">{vessel.vesselName}</div>
            <div className="asb-checkin__meta">{vessel.vesselType} · IMO {vessel.imo}</div>
          </div>
          <button type="button" className="asb-checkin__x" onClick={close} aria-label="Close"><X size={15} /></button>
        </div>

        {mode === "done" ? (
          <div className="asb-checkin__doneband">
            <span className="asb-checkin__tick" aria-hidden="true"><Check size={15} /></span>
            <span>{doneMsg}</span>
          </div>
        ) : (
          <>
            <div className="asb-checkin__onfile">
              <span style={{ width: 7, height: 7, borderRadius: 99, background: urgDot, flexShrink: 0 }} />
              <span>
                On file: open <strong>{vessel.openPort}</strong> ({vessel.openZone}) · <strong>{onFileDate}</strong>
              </span>
            </div>

            {mode === "ask" && (
              <>
                <p className="asb-checkin__q">Is this position still accurate?</p>
                <div className="asb-checkin__actions">
                  <button type="button" className="asb-btn primary" disabled={busy} onClick={confirm}>
                    Confirm, still accurate
                  </button>
                  <button type="button" className="asb-btn" onClick={() => setMode("update")}>
                    Update position
                  </button>
                </div>
              </>
            )}

            {mode === "update" && (
              <div className="asb-checkin__form">
                <div className="asb-checkin__field">
                  <label className="asb-checkin__label">Next port (ETA port)</label>
                  <input
                    className="asb-checkin__input"
                    placeholder="Search port or LOCODE…"
                    value={port ? `${port.trade_name} (${port.locode})` : portQ}
                    onChange={(e) => {
                      setPort(null);
                      setPortQ(e.target.value);
                      setShowDrop(true);
                    }}
                    onFocus={() => setShowDrop(true)}
                  />
                  {results.length > 0 && !port && (
                    <div className="asb-checkin__drop">
                      {results.map((p) => (
                        <div
                          key={p.locode}
                          className="asb-checkin__opt"
                          onMouseDown={() => {
                            setPort(p);
                            setShowDrop(false);
                          }}
                        >
                          <span>{p.trade_name}</span>
                          <small>{p.locode} · {p.country}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="asb-checkin__row">
                  <div className="asb-checkin__field">
                    <label className="asb-checkin__label">ETA date</label>
                    <input className="asb-checkin__input" type="date" value={etaDate} onChange={(e) => setEtaDate(e.target.value)} />
                  </div>
                  <div className="asb-checkin__field">
                    <label className="asb-checkin__label">ETA time (LT)</label>
                    <input className="asb-checkin__input" type="time" value={etaTime} onChange={(e) => setEtaTime(e.target.value)} />
                  </div>
                </div>
                <div className="asb-checkin__field">
                  <label className="asb-checkin__label">Open date (after discharge)</label>
                  <input className="asb-checkin__input" type="date" value={openDate} onChange={(e) => setOpenDate(e.target.value)} />
                </div>
                <div className="asb-checkin__actions">
                  <button
                    type="button"
                    className="asb-btn primary"
                    disabled={!canSave}
                    style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                    onClick={save}
                  >
                    Save position
                  </button>
                  <button type="button" className="asb-btn" onClick={() => setMode("ask")}>Back</button>
                </div>
              </div>
            )}

            {err && <div style={{ marginTop: 8, fontSize: 11, color: "var(--asb-red, #E24B4A)" }}>{err}</div>}

            <div className="asb-checkin__foot">
              <span>Routine check-in keeps your listing trusted. AIS feeds may prefill this; your confirmation still counts.</span>
              <button type="button" className="asb-checkin__later" onClick={close}>Remind me later</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
