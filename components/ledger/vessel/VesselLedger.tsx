"use client";

// Broker Ledger — Post Vessel (position) page component. Config transcribed
// from the Concept 4 bundle (reference/handoff/mount-config-vessel.jsx);
// step bodies live in ./steps/*.

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getVesselRegistryById } from "@/sdk/app/ledger";
import { saveWorkingState } from "../drafts";
import { registryHitToVessel } from "./steps/VesselStep";
import { LedgerShell } from "../LedgerShell";
import type { LedgerConfig, LedgerRepost } from "../types";
import { loadVesselReposts } from "./reposts";
import { validateImoCheckDigit } from "@/lib/schemas/cargo";
import { SIZE_GATE_DWT } from "../defs";
import { VESSEL_STORAGE_KEY, initialVesselState, type VesselState } from "./state";
import { submitVesselPosition } from "./mapState";
import { VesselStep, vesselComplete, vesselSummary } from "./steps/VesselStep";
import { ArrangementStep, arrComplete, arrSummary } from "./steps/ArrangementStep";
import { AvailabilityStep, avComplete, avSummary } from "./steps/AvailabilityStep";
import { PerformanceStep, perfComplete, perfSummary } from "./steps/PerformanceStep";
import { GearStep, gearComplete, gearSummary } from "./steps/GearStep";
import { ReviewStep, revComplete } from "./steps/ReviewStep";
import { BosunVesselPanel } from "../BosunPanel";

export function VesselLedger() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectId = searchParams.get("vessel");
  // Arriving from a vessel's detail page ("Post position") preselects her:
  // the registry record is seeded into the working draft before the shell
  // hydrates from localStorage.
  const [ready, setReady] = useState(!preselectId);
  useEffect(() => {
    if (!preselectId) return;
    let alive = true;
    (async () => {
      try {
        const hit = await getVesselRegistryById(getSupabaseBrowserClient(), preselectId);
        if (hit) {
          const vessel = registryHitToVessel(hit);
          saveWorkingState<VesselState>(VESSEL_STORAGE_KEY, { entryMode: "search", vessel, vesselImo: vessel.imo ?? null });
        }
      } catch {
        /* fall back to a blank form */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [preselectId]);

  const [reposts, setReposts] = useState<LedgerRepost<VesselState>[]>([]);

  // "Repost a past posting" — the user's recent positions, loaded once.
  useEffect(() => {
    let alive = true;
    loadVesselReposts(getSupabaseBrowserClient())
      .then((r) => alive && setReposts(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const config: LedgerConfig<VesselState> = {
    storageKey: VESSEL_STORAGE_KEY,
    eyebrow: "Post Position",
    title: "List a vessel's open position",
    subtitle: "The minimum a charterer needs to match and estimate. The platform and Bosun AI fill in the rest.",
    icon: "Vessel",
    submitLabel: "Post position",
    submitToast: "Position posted for matching",
    exitHref: "/dashboard/vessels",
    initialState: initialVesselState,
    draftLabel: (s) => {
      const v = s.vessel;
      if (v && (v.name || v.imo)) return (v.name || "Vessel") + (v.imo ? " (" + v.imo + ")" : "");
      if (s.entryMode === "tbn" && s.tbn?.type) return "TBN · " + s.tbn.type;
      return "Untitled position";
    },
    // SCORING POLICY — see CargoLedger: mand = *-marked inputs; opt = every
    // other fillable input; toggles/derived/defaulted fields excluded;
    // inputs not available in the current mode (TBN vs search vs registry
    // pick) return null so they never count against the score.
    steps: [
      {
        id: "vessel",
        title: "Vessel",
        hint: "Identity, tonnage, ownership.",
        // Aligned with vesselComplete: IMO must pass the check digit for a
        // hand-entered vessel (N/A for TBN), DWT must clear the 66k niche
        // gate, and flag is N/A for registry picks (comes from the record).
        mand: [
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.type : !!s.vessel?.name),
          (s) =>
            s.entryMode === "tbn"
              ? null
              : s.vessel
                ? s.vessel.id
                  ? null // registry record IS the identity; legacy rows may lack IMO
                  : !!(s.vessel.imo && validateImoCheckDigit(s.vessel.imo))
                : false,
          (s) => {
            const dwt = Number(s.entryMode === "tbn" ? s.tbn?.dwt : s.vessel?.dwt) || 0;
            return dwt > 0 && dwt <= SIZE_GATE_DWT;
          },
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.type : !!s.vessel?.type),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.flag : s.vessel ? (s.vessel.id ? null : !!s.vessel.flag) : false),
        ],
        // Mode-aware optionals (`verified` stays excluded — ASB-set): TBN has
        // its own particulars form; a registry pick has no editable identity
        // inputs (only the ownership chain), so those score null there.
        opt: [
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.built : s.vessel ? (s.vessel.id ? null : !!s.vessel.built) : false),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.loa : s.vessel ? (s.vessel.id ? null : !!s.vessel.loa) : false),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.beam : null),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.draft : null),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.grt : null),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.classSociety : null),
          (s) => (s.entryMode === "tbn" ? null : !!s.vessel?.regOwner),
        ],
        render: (ctx) => <VesselStep {...ctx} />,
        summary: vesselSummary,
        complete: vesselComplete,
      },
      {
        id: "arrangement",
        title: "Arrangement",
        hint: "Holds, hatches, configuration.",
        mand: [
          (s) => !!s.arrangement?.numHolds,
          (s) => !!s.arrangement?.boxShaped,
          (s) => !!s.arrangement?.hatchType,
          (s) => !!s.arrangement?.strengthenedHeavy,
          (s) => !!s.arrangement?.logFitted,
        ],
        opt: [(s) => !!s.arrangement?.config, (s) => !!s.arrangement?.numHatches, (s) => !!s.arrangement?.holdsMayBeEmpty],
        render: (ctx) => <ArrangementStep {...ctx} />,
        summary: arrSummary,
        complete: arrComplete,
      },
      {
        id: "availability",
        title: "Availability",
        hint: "Status, open port, dates, zone.",
        mand: [(s) => !!s.availability?.status, (s) => !!s.availability?.openPort?.locode, (s) => !!s.availability?.openFrom],
        // WOG off is a valid answer (firm rates) — a toggle must not drag the %.
        opt: [(s) => !!s.availability?.charterType, (s) => !!(s.availability?.zones && s.availability.zones.length > 0), (s) => !!s.availability?.direction],
        render: (ctx) => <AvailabilityStep {...ctx} />,
        summary: avSummary,
        complete: avComplete,
      },
      {
        id: "performance",
        title: "Performance",
        hint: "Fuel, consumption, speed.",
        mand: [],
        opt: [
          (s) => !!s.performance?.fuelType,
          (s) => !!s.performance?.serviceSpeed,
          (s) => !!s.performance?.meConsSea,
          (s) => !!s.performance?.meConsPort,
          (s) => !!s.performance?.auxConsPort,
          (s) => !!s.performance?.brob,
        ],
        render: (ctx) => <PerformanceStep {...ctx} />,
        summary: perfSummary,
        // Advisory: never blocks posting (complete stays true for the submit
        // gate) but only shows done in the sidebar once it carries data.
        complete: perfComplete,
        progressDone: (s) => {
          const p = s.performance;
          return !!(p && (p.serviceSpeed || p.fuelType || p.meConsSea || p.meConsPort || p.auxConsPort || p.brob));
        },
      },
      {
        id: "gear",
        title: "Gear",
        hint: "Cranes, grabs.",
        mand: [
          (s) => s.gear?.geared != null,
          (s) => (s.gear?.geared ? !!s.gear.craneCount : null),
          (s) => (s.gear?.geared ? !!s.gear.craneSwl : null),
        ],
        // Grabs / kick-plate are toggles (off = valid answer); grab details only
        // count once grabs are switched on.
        opt: [
          (s) => (s.gear?.geared && s.gear.grabs ? !!s.gear.numGrabs : null),
          (s) => (s.gear?.geared && s.gear.grabs ? !!s.gear.grabCapacity : null),
        ],
        render: (ctx) => <GearStep {...ctx} />,
        summary: gearSummary,
        complete: gearComplete,
      },
      {
        id: "review",
        title: "Review",
        hint: "Confirm and post.",
        render: (ctx) => <ReviewStep {...ctx} />,
        summary: () => "Confirm and post",
        complete: revComplete,
      },
    ],
    recents: [
      { label: "VLSFO", patch: (s) => ({ performance: { ...(s.performance || {}), fuelType: "VLSFO", _source: "user" as const } }) },
      { label: "Status: Open", patch: (s) => ({ availability: { ...(s.availability || {}), status: "Open" } }) },
      { label: "Charter: TCT", patch: (s) => ({ availability: { ...(s.availability || {}), charterType: "TCT" } }) },
    ],
    reposts,
    onSubmit: async (state) => {
      const result = await submitVesselPosition(state);
      router.refresh();
      return result.ref ? `Position ${result.ref} posted for matching` : "Position posted for matching";
    },
    assistant: ({ applyPatch, revealIncomplete }) => (
      <BosunVesselPanel onApplyVessel={applyPatch} onApplied={revealIncomplete} />
    ),
  };

  if (!ready) return null; // resolving the preselected vessel into the draft
  return <LedgerShell config={config} />;
}
