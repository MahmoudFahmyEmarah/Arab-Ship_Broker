"use client";

// The match builder as designed (fxm): pick your side, then the ranked
// opposite side, open the room. Candidates come from the governed
// list_fixture_match_candidates (one matching source, never a client-side
// scorer; own listings only; a TBN hull is named "TBN" and carries no vessel
// id or IMO). The reasons on each card are the facts of the rule that matched
// the pair, as the database reports them, so an explanation can never
// contradict a valid match (C2O-012 item 4). State is transient; the room is
// the record.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createFixtureRoomFromCandidateAction, loadMatchCandidates, type MatchBuilderData, type MatchCargoOption, type MatchFacts, type MatchVesselOption } from "@/app/(dashboard)/dashboard/fixture-room/actions";
import { GestureKeys, UNCERTAIN_MESSAGE, runGesture } from "@/lib/fixture-room/client";
import { FIXTURE_ERROR_TITLE } from "@/lib/fixture-room/errors";

type First = { kind: "cargo"; cargo: MatchCargoOption } | { kind: "vessel"; vessel: MatchVesselOption };
type Reason = { kind: "ok" | "info"; txt: string };
type Fit = { tier: "strong" | "possible" | "weak"; reasons: Reason[] };

const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const laycan = (c: MatchCargoOption) => (c.isSpot ? "SPOT" : c.laycanFrom || c.laycanTo ? `${c.laycanFrom ?? "—"} – ${c.laycanTo ?? "—"}` : "—");

/**
 * Why the governed match holds, from the facts the matcher reports (zone, laycan
 * rule, grain / DG certification, gear, capacity band). Every fact is a rule the
 * pair passed, so each reads as a tick; the freight ideas are shown for
 * information only, since they are not a matching rule. The tier ranks within
 * valid matches: rate alignment and how closely the hull fits the parcel.
 */
export function assessFit(c: MatchCargoOption, v: MatchVesselOption, f: MatchFacts | undefined): Fit {
  const reasons: Reason[] = [];
  let score = 0;
  if (f) {
    const band = f.partCargo ? "part cargo, 80–120 %" : "90–110 %";
    const close = c.qtyMax > 0 && f.dwtDelta <= c.qtyMax * 0.05;
    score += close ? 2 : 1;
    reasons.push({ kind: "ok", txt: `Fits ${fmt(c.qtyMin)}–${fmt(c.qtyMax)} MT (${band})` });
    reasons.push({ kind: "ok", txt: f.zone === "load" ? "Open in the load zone" : "Open in the discharge zone" });
    reasons.push({ kind: "ok", txt: f.laycan === "spot" ? "Spot cargo · prompt tonnage" : "Opens within the laycan window (−21 / +14 days)" });
    if (f.laycan === "window") score += 1;
    if (f.grain) reasons.push({ kind: "ok", txt: "Grain certified" });
    if (f.dg) reasons.push({ kind: "ok", txt: "DG certified" });
    if (f.gearRequired) reasons.push({ kind: "ok", txt: "Geared, as the cargo requires" });
  }
  if (c.rateAligned === true || v.rateAligned === true) { score += 2; reasons.push({ kind: "ok", txt: "Freight ideas aligned (within $5)" }); }
  else if (c.freightIdea != null && v.freightIdea != null) reasons.push({ kind: "info", txt: `Ideas $${Number(c.freightIdea).toFixed(2)} vs $${Number(v.freightIdea).toFixed(2)}` });
  return { tier: score >= 4 ? "strong" : score >= 2 ? "possible" : "weak", reasons };
}

function Reasons({ fit }: { fit?: Fit }) {
  if (!fit) return null;
  // every reason is shown: a truncated list could hide the one the reader needs (C2O-012 item 4)
  return (
    <ul className="fxm-reasons" aria-label="Why this matches">
      {fit.reasons.map((r, i) => <li key={i} className={`fxm-reason ${r.kind === "ok" ? "ok" : "info"}`}><span aria-hidden="true">{r.kind === "ok" ? "✓" : "·"}</span> {r.txt}</li>)}
    </ul>
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
      <div className="fxm-card__name">{v.name}{v.isTbn && v.name === "TBN" && <span className="nr-tag" title="The owner discloses the hull when the fixture allows it">identity withheld</span>}</div>
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
      const res = await loadMatchCandidates(f.kind, (f.kind === "cargo" ? f.cargo.id : f.vessel.availabilityId) ?? "");
      setCandidates({ cargo: res.cargo, vessels: res.vessels });
      setError(res.error ?? null);
    } catch {
      setCandidates({ cargo: [], vessels: [] });
      setError("Could not load the ranked counterparts. Pick again to retry.");
    } finally {
      setLoadingCands(false);
    }
  };

  // C2O-013: the counterparty is named by its opaque candidate key only
  const open = async (candidateKey: string | undefined, hints: Record<string, unknown> | null | undefined) => {
    if (!candidateKey) return;
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await runGesture(keys, `open:${candidateKey}`, (idempotencyKey) =>
        createFixtureRoomFromCandidateAction({ candidateKey, hints: hints ?? null, idempotencyKey }));
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
                ? candidates.vessels.map((v) => <VesselPick key={v.candidateKey} v={v} fit={assessFit(first.cargo, v, v.fit)} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(v.candidateKey, v.hints)} testId="cand-vessel" />)
                : candidates.cargo.map((c) => <CargoPick key={c.candidateKey} c={c} fit={assessFit(c, first.vessel, c.fit)} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(c.candidateKey, c.hints)} testId="cand-cargo" />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
