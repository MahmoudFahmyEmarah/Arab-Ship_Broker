"use client";

// The match builder: pick your side, then the ranked opposite side, open the
// room. Candidates come from the existing match RPCs (one matching source),
// never from a client-side scorer. State is transient; the room is the record.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createFixtureRoomAction, loadMatchCandidates, type MatchBuilderData, type MatchCargoOption, type MatchVesselOption } from "@/app/(dashboard)/dashboard/fixture-room/actions";
import { GestureKeys, UNCERTAIN_MESSAGE, runGesture } from "@/lib/fixture-room/client";
import { FIXTURE_ERROR_TITLE } from "@/lib/fixture-room/errors";

type First = { kind: "cargo"; cargo: MatchCargoOption } | { kind: "vessel"; vessel: MatchVesselOption };

const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const laycan = (c: MatchCargoOption) => (c.isSpot ? "SPOT" : c.laycanFrom || c.laycanTo ? `${c.laycanFrom ?? "—"} – ${c.laycanTo ?? "—"}` : "—");

function CargoPick({ c, cta, onPick, locked, testId }: { c: MatchCargoOption; cta?: string; onPick?: () => void; locked?: boolean; testId?: string }) {
  return (
    <div className={`fxr-pick${locked ? " is-locked" : ""}`} data-testid={testId}>
      <div className="fxr-pick__top">
        <span className="fxr-pick__badge is-cargo">Cargo</span>
        <span className="fxr-pick__ref">{c.ref ?? "—"}</span>
        {c.rateAligned && <span className="fxr-tag is-ok">rate aligned</span>}
        {c.mine && <span className="fxr-tag">mine</span>}
      </div>
      <div className="fxr-pick__name">{c.commodity}</div>
      <div className="fxr-pick__spec">{fmt(c.qtyMin)}–{fmt(c.qtyMax)} MT · {c.type}</div>
      <div className="fxr-pick__route">{c.loadPort ?? "—"} <span className="fxr-arr">→</span> {c.dischPort ?? "—"}</div>
      <div className="fxr-pick__meta">Laycan {laycan(c)}{c.freightIdea != null ? ` · idea $${Number(c.freightIdea).toFixed(2)}/MT` : ""}</div>
      {onPick && !locked && <button type="button" className="asb-btn primary fxr-pick__cta" onClick={onPick}>{cta ?? "Select"}</button>}
    </div>
  );
}

function VesselPick({ v, cta, onPick, locked, testId }: { v: MatchVesselOption; cta?: string; onPick?: () => void; locked?: boolean; testId?: string }) {
  return (
    <div className={`fxr-pick${locked ? " is-locked" : ""}`} data-testid={testId}>
      <div className="fxr-pick__top">
        <span className="fxr-pick__badge is-vessel">Vessel</span>
        <span className="fxr-pick__ref">{v.type}</span>
        {v.rateAligned && <span className="fxr-tag is-ok">rate aligned</span>}
        {v.mine && <span className="fxr-tag">mine</span>}
      </div>
      <div className="fxr-pick__name">{v.name}</div>
      <div className="fxr-pick__spec">{fmt(v.dwt)} DWT{v.geared != null ? ` · ${v.geared ? "geared" : "gearless"}` : ""}</div>
      <div className="fxr-pick__route">Open {v.openPort ?? "—"}{v.openZone ? ` (${v.openZone})` : ""}</div>
      <div className="fxr-pick__meta">{v.openDate ?? "open date —"}{v.freightIdea != null ? ` · idea $${Number(v.freightIdea).toFixed(2)}/MT` : ""}</div>
      {onPick && !locked && <button type="button" className="asb-btn primary fxr-pick__cta" onClick={onPick}>{cta ?? "Select"}</button>}
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

  return (
    <div className="fxr">
      <div className="fxr-page fxr-builder" data-testid="match-builder">
        {error && <div className="fxr-banner is-error" role="alert" data-testid="builder-error">{error}</div>}
        {!first ? (
          <>
            <div className="fxr-page__head">
              <div>
                <h1 className="fxr-title">Start a fixture</h1>
                <p className="fxr-sub">Pick one of your own listings first. Arab ShipBroker then shows the opposite side ranked by fit · you fix a cargo to a vessel, never like to like.</p>
              </div>
              <div className="fxr-steps"><span className="is-on">1 · Your side</span><span>2 · Counterparty</span></div>
            </div>
            <div className="fxr-seg" role="tablist" aria-label="Start from">
              <button role="tab" aria-selected={side === "cargo"} className={side === "cargo" ? "is-on" : ""} onClick={() => setSide("cargo")}>From my cargo <span className="fxr-seg__n">{data.myCargo.length}</span></button>
              <button role="tab" aria-selected={side === "vessel"} className={side === "vessel" ? "is-on" : ""} onClick={() => setSide("vessel")}>From my positions <span className="fxr-seg__n">{data.myVessels.length}</span></button>
            </div>
            {list.length === 0 ? (
              <div className="fxr-empty" data-testid="builder-empty">
                <div className="fxr-empty__title">{side === "cargo" ? "You have no cargo listings" : "You have no open positions"}</div>
                <div className="fxr-empty__sub">
                  {side === "cargo" ? <Link href="/dashboard/cargo/post">Post a cargo</Link> : <Link href="/dashboard/vessels/post">Post a position</Link>} first, then open a room from it.
                </div>
              </div>
            ) : (
              <div className="fxr-grid">
                {side === "cargo"
                  ? data.myCargo.map((c) => <CargoPick key={c.id} c={c} cta="Fix this cargo" onPick={() => pickFirst({ kind: "cargo", cargo: c })} testId={`pick-cargo-${c.id}`} />)
                  : data.myVessels.map((v) => <VesselPick key={v.availabilityId} v={v} cta="Fix this vessel" onPick={() => pickFirst({ kind: "vessel", vessel: v })} testId={`pick-vessel-${v.availabilityId}`} />)}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="fxr-page__head">
              <div>
                <h1 className="fxr-title">Match the {first.kind}</h1>
                <p className="fxr-sub">Your {first.kind} is fixed. Choose a {oppNoun} to open the room · ranked by the platform&apos;s matching rules.</p>
              </div>
              <div className="fxr-steps"><span className="is-done">1 · Your side</span><span className="is-on">2 · Counterparty</span></div>
            </div>
            <div className="fxr-locked-pick">
              <span className="fxr-locked-pick__tag">Your side</span>
              <div className="fxr-locked-pick__card">
                {first.kind === "cargo" ? <CargoPick c={first.cargo} locked /> : <VesselPick v={first.vessel} locked />}
              </div>
              <button type="button" className="asb-btn" onClick={() => { setFirst(null); setCandidates({ cargo: [], vessels: [] }); }}>Change</button>
            </div>
            <div className="fxr-opphd">
              {first.kind === "cargo" ? "Available tonnage" : "Open cargoes"}
              <span>{loadingCands ? "loading…" : `${first.kind === "cargo" ? candidates.vessels.length : candidates.cargo.length} shown · ranked by fit`}</span>
            </div>
            {!loadingCands && (first.kind === "cargo" ? candidates.vessels : candidates.cargo).length === 0 && (
              <div className="fxr-empty" data-testid="builder-no-candidates">
                <div className="fxr-empty__title">No live match for this {first.kind} right now</div>
                <div className="fxr-empty__sub">Matches follow the platform&apos;s rules (zone, size, laycan, certification). Check back when the market moves, or pick another listing.</div>
              </div>
            )}
            <div className="fxr-grid">
              {first.kind === "cargo"
                ? candidates.vessels.map((v) => <VesselPick key={v.availabilityId} v={v} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(first.cargo.id, v.availabilityId)} testId={`cand-vessel-${v.availabilityId}`} />)
                : candidates.cargo.map((c) => <CargoPick key={c.id} c={c} cta={busy ? "Opening…" : "Open fixture →"} onPick={() => open(c.id, first.vessel.availabilityId)} testId={`cand-cargo-${c.id}`} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
