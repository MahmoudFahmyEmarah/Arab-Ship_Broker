"use client";

// The match builder as designed (fxm): pick your side, then the ranked
// opposite side, open the room. Candidates come from the existing match RPCs
// (one matching source, never a client-side scorer); the fit tier and the
// reasons on each card only explain what the platform's match already says,
// from the same listing fields the card shows. State is transient; the room
// is the record.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createFixtureRoomAction, loadMatchCandidates, type MatchBuilderData, type MatchCargoOption, type MatchVesselOption } from "@/app/(dashboard)/dashboard/fixture-room/actions";
import { GestureKeys, UNCERTAIN_MESSAGE, runGesture } from "@/lib/fixture-room/client";
import { FIXTURE_ERROR_TITLE } from "@/lib/fixture-room/errors";

type First = { kind: "cargo"; cargo: MatchCargoOption } | { kind: "vessel"; vessel: MatchVesselOption };
type Fit = { tier: "strong" | "possible" | "weak"; reasons: { ok: boolean; txt: string }[] };

const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const laycan = (c: MatchCargoOption) => (c.isSpot ? "SPOT" : c.laycanFrom || c.laycanTo ? `${c.laycanFrom ?? "—"} – ${c.laycanTo ?? "—"}` : "—");

/** Why the platform's match holds, in the cargo's and vessel's own figures. */
export function assessFit(c: MatchCargoOption, v: MatchVesselOption): Fit {
  const reasons: { ok: boolean; txt: string }[] = [];
  let score = 0;
  if (v.dwt != null) {
    if (v.dwt >= c.qtyMax) { score += 2; reasons.push({ ok: true, txt: `Fits ${fmt(c.qtyMax)} MT` }); }
    else if (v.dwt >= c.qtyMin) { score += 1; reasons.push({ ok: true, txt: `Fits ${fmt(c.qtyMin)} MT min` }); }
    else reasons.push({ ok: false, txt: "Under capacity" });
  }
  if (c.rateAligned === true || v.rateAligned === true) { score += 2; reasons.push({ ok: true, txt: "Rate aligned" }); }
  else if (c.freightIdea != null && v.freightIdea != null) reasons.push({ ok: Math.abs(c.freightIdea - v.freightIdea) <= Math.max(1, c.freightIdea * 0.1), txt: `Idea $${Number(c.freightIdea).toFixed(2)} vs $${Number(v.freightIdea).toFixed(2)}` });
  if (!c.isSpot && c.laycanFrom && v.openDate) {
    const open = Date.parse(v.openDate), from = Date.parse(c.laycanFrom), to = c.laycanTo ? Date.parse(c.laycanTo) : from;
    if (!Number.isNaN(open) && !Number.isNaN(from)) {
      if (open <= to + 86_400_000) { score += 1; reasons.push({ ok: true, txt: "Open within laycan" }); }
      else reasons.push({ ok: false, txt: "Opens after laycan" });
    }
  } else if (c.isSpot && v.openDate) { score += 1; reasons.push({ ok: true, txt: "Prompt tonnage" }); }
  if (/break/i.test(c.type) && v.geared != null) {
    if (v.geared) { score += 1; reasons.push({ ok: true, txt: "Geared" }); }
    else reasons.push({ ok: false, txt: "Gearless" });
  }
  return { tier: score >= 4 ? "strong" : score >= 2 ? "possible" : "weak", reasons };
}

function Reasons({ fit }: { fit?: Fit }) {
  if (!fit) return null;
  return (
    <>
      <div className="fxm-reasons">
        {fit.reasons.slice(0, 3).map((r, i) => <span key={i} className={`fxm-reason ${r.ok ? "ok" : "no"}`}>{r.ok ? "✓" : "✕"} {r.txt}</span>)}
      </div>
    </>
  );
}

function CargoPick({ c, cta, onPick, locked, fit, testId }: { c: MatchCargoOption; cta?: string; onPick?: () => void; locked?: boolean; fit?: Fit; testId?: string }) {
  return (
    <div className={`fxm-card${locked ? " is-locked" : ""}`} data-testid={testId}>
      <div className="fxm-card__top">
        <span className="fxm-card__badge cargo">Cargo</span>
        <span className="fxm-card__ref">{c.ref ?? "—"}</span>
        {fit && <span className={`fxm-match ${fit.tier}`}>{fit.tier}</span>}
        {c.mine && <span className="nr-tag">mine</span>}
      </div>
      <div className="fxm-card__name">{c.commodity}</div>
      <div className="fxm-card__spec">{fmt(c.qtyMin)}–{fmt(c.qtyMax)} MT · {c.type}</div>
      <div className="fxm-card__route">{c.loadPort ?? "—"} <span className="arr">→</span> {c.dischPort ?? "—"}</div>
      <div className="fxm-card__meta">Laycan {laycan(c)}{c.freightIdea != null ? ` · idea $${Number(c.freightIdea).toFixed(2)}/MT` : ""}</div>
      <Reasons fit={fit} />
      {onPick && !locked && <button type="button" className="asb-btn primary fxm-card__cta" onClick={onPick}>{cta ?? "Select"}</button>}
    </div>
  );
}

function VesselPick({ v, cta, onPick, locked, fit, testId }: { v: MatchVesselOption; cta?: string; onPick?: () => void; locked?: boolean; fit?: Fit; testId?: string }) {
  return (
    <div className={`fxm-card${locked ? " is-locked" : ""}`} data-testid={testId}>
      <div className="fxm-card__top">
        <span className="fxm-card__badge vessel">Vessel</span>
        <span className="fxm-card__ref">{v.type}</span>
        {fit && <span className={`fxm-match ${fit.tier}`}>{fit.tier}</span>}
        {v.mine && <span className="nr-tag">mine</span>}
      </div>
      <div className="fxm-card__name">{v.name}</div>
      <div className="fxm-card__spec">{fmt(v.dwt)} DWT{v.geared != null ? ` · ${v.geared ? "geared" : "gearless"}` : ""}</div>
      <div className="fxm-card__route">Open {v.openPort ?? "—"}{v.openZone ? ` (${v.openZone})` : ""}</div>
      <div className="fxm-card__meta">{v.openDate ?? "open date —"}{v.freightIdea != null ? ` · idea $${Number(v.freightIdea).toFixed(2)}/MT` : ""}</div>
      <Reasons fit={fit} />
      {onPick && !locked && <button type="button" className="asb-btn primary fxm-card__cta" onClick={onPick}>{cta ?? "Select"}</button>}
    </div>
  );
}

export function MatchBuilder({ data }: { data: MatchBuilderData }) {
  const router = useRouter();
  const [side, setSide] = React.useState<"cargo" | "vessel">(data.preselected?.kind === "vessel" ? "vessel" : "cargo");
  const [first, setFirst] = React.useState<First | null>(() => {
    if (data.preselected?.kind === "cargo") {
      const c = data.myCargo.find((x) => x.id === data.preselected!.id);
      if (c) return { kind: "cargo", cargo: c };
    }
    if (data.preselected?.kind === "vessel") {
      const v = data.myVessels.find((x) => x.availabilityId === data.preselected!.id);
      if (v) return { kind: "vessel", vessel: v };
    }
    return null;
  });
  const [candidates, setCandidates] = React.useState(data.candidates);
  const [loadingCands, setLoadingCands] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(data.error);
  // one key per pairing gesture, kept until the server has answered (audit FR-M5)
  const keys = React.useMemo(() => new GestureKeys(), []);

  const pickFirst = async (f: First) => {
    setFirst(f);
    setLoadingCands(true);
    try {
      setCandidates(await loadMatchCandidates(f.kind, f.kind === "cargo" ? f.cargo.id : f.vessel.availabilityId));
    } catch {
      setCandidates({ cargo: [], vessels: [] });
      setError("Could not load the ranked counterparts. Pick again to retry.");
    } finally {
      setLoadingCands(false);
    }
  };

  const open = async (cargoListingId: string, vesselAvailabilityId: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runGesture(keys, `open:${cargoListingId}:${vesselAvailabilityId}`, (idempotencyKey) =>
        createFixtureRoomAction({ cargoListingId, vesselAvailabilityId, idempotencyKey }));
      if (outcome.kind === "ok") {
        toast.success(outcome.result.replayed ? "Opening your existing room" : `Room ${outcome.result.data.ref} opened`);
        router.push(`/dashboard/fixture-room/${outcome.result.data.roomId}`);
        return;
      }
      if (outcome.kind === "refused") {
        if (outcome.error.code === "CONFLICT" && outcome.error.roomId) {
          toast.message("A room already covers this pairing — opening it");
          router.push(`/dashboard/fixture-room/${outcome.error.roomId}`);
          return;
        }
        setError(`${FIXTURE_ERROR_TITLE[outcome.error.code]}: ${outcome.error.message}`);
        return;
      }
      // uncertain: the room may exist; the key is kept, so "Open fixture" again replays instead of duplicating
      setError(UNCERTAIN_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const oppNoun = first ? (first.kind === "cargo" ? "vessel" : "cargo") : "";
  const list = side === "cargo" ? data.myCargo : data.myVessels;
  const shown = first ? (first.kind === "cargo" ? candidates.vessels.length : candidates.cargo.length) : 0;

  return (
    <div className="nr fxm-wrap">
      <div className="fxm" data-testid="match-builder">
        {error && <div className="nr-banner is-error" role="alert" data-testid="builder-error"><div className="nr-banner__body">{error}</div></div>}
        {!first ? (
          <>
            <div className="fxm__head">
              <div>
                <h1 className="fxm__title">Start a fixture</h1>
                <p className="fxm__sub">Pick one of your own listings first. Arab ShipBroker then shows the opposite side ranked by fit · you fix a cargo to a vessel, never like to like.</p>
              </div>
              <div className="fxm__step"><span className="is-on">1 · Your side</span><span>2 · Counterparty</span></div>
            </div>
            <div className="fxm__seg" role="tablist" aria-label="Start from">
              <button role="tab" aria-selected={side === "cargo"} className={side === "cargo" ? "is-on" : ""} onClick={() => setSide("cargo")}>From my cargo<span className="fxm__n">{data.myCargo.length}</span></button>
              <button role="tab" aria-selected={side === "vessel"} className={side === "vessel" ? "is-on" : ""} onClick={() => setSide("vessel")}>From my vessels<span className="fxm__n">{data.myVessels.length}</span></button>
            </div>
            {list.length === 0 ? (
              <div className="nr-empty" data-testid="builder-empty">
                <div className="nr-empty__title">{side === "cargo" ? "You have no cargo listings" : "You have no open positions"}</div>
                <div className="nr-empty__sub">
                  {side === "cargo" ? <Link href="/dashboard/cargo/post">Post a cargo</Link> : <Link href="/dashboard/vessels/post">Post a position</Link>} first, then open a room from it.
                </div>
              </div>
            ) : (
              <div className="fxm__grid">
                {side === "cargo"
                  ? data.myCargo.map((c) => <CargoPick key={c.id} c={c} cta="Fix this cargo" onPick={() => pickFirst({ kind: "cargo", cargo: c })} testId={`pick-cargo-${c.id}`} />)
                  : data.myVessels.map((v) => <VesselPick key={v.availabilityId} v={v} cta="Fix this vessel" onPick={() => pickFirst({ kind: "vessel", vessel: v })} testId={`pick-vessel-${v.availabilityId}`} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="fxm__head">
              <div>
                <h1 className="fxm__title">Match the {first.kind}</h1>
                <p className="fxm__sub">Your {first.kind} is fixed. Choose a {oppNoun} to open the Fixture Room · ranked by how well it fits.</p>
              </div>
              <div className="fxm__step"><span className="done">1 · Your side</span><span className="is-on">2 · Counterparty</span></div>
            </div>
            <div className="fxm__locked">
              <span className="fxm__lockedtag">Your side · fixed</span>
              <div className="fxm__lockedcard">
                {first.kind === "cargo" ? <CargoPick c={first.cargo} locked /> : <VesselPick v={first.vessel} locked />}
              </div>
              <button type="button" className="asb-btn" onClick={() => { setFirst(null); setCandidates({ cargo: [], vessels: [] }); }}>Change</button>
            </div>
            <div className="fxm__opphd">
              {first.kind === "cargo" ? "Available tonnage" : "Open cargoes"}
              <span>{loadingCands ? "loading…" : `${shown} shown · ranked by fit`}</span>
            </div>
            {!loadingCands && shown === 0 && (
              <div className="nr-empty" data-testid="builder-no-candidates">
                <div className="nr-empty__title">No live match for this {first.kind} right now</div>
                <div className="nr-empty__sub">Matches follow the platform&apos;s rules (zone, size, laycan, certification). Check back when the market moves, or pick another listing.</div>
              </div>
            )}
            <div className="fxm__grid">
              {first.kind === "cargo"
                ? candidates.vessels.map((v) => <VesselPick key={v.availabilityId} v={v} fit={assessFit(first.cargo, v)} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(first.cargo.id, v.availabilityId)} testId={`cand-vessel-${v.availabilityId}`} />)
                : candidates.cargo.map((c) => <CargoPick key={c.id} c={c} fit={assessFit(c, first.vessel)} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(c.id, first.vessel.availabilityId)} testId={`cand-cargo-${c.id}`} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
