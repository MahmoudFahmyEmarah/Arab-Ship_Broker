"use client";

// Broker Ledger — Post Vessel (position) page component. Config transcribed
// from the Concept 4 bundle (reference/handoff/mount-config-vessel.jsx);
// step bodies live in ./steps/*.

import * as React from "react";
import { useRouter } from "next/navigation";
import { LedgerShell } from "../LedgerShell";
import type { LedgerConfig } from "../types";
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
    steps: [
      {
        id: "vessel",
        title: "Vessel",
        hint: "Identity, tonnage, ownership.",
        mand: [
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.type : !!(s.vessel && (s.vessel.name || s.vessel.imo))),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.dwt : !!s.vessel?.dwt),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.type : !!s.vessel?.type),
          (s) => (s.entryMode === "tbn" ? !!s.tbn?.flag : !!s.vessel?.flag),
        ],
        opt: [(s) => !!s.vessel?.built, (s) => !!s.vessel?.classSociety, (s) => !!s.vessel?.verified, (s) => !!s.vessel?.regOwner],
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
        opt: [(s) => !!s.arrangement?.config, (s) => !!s.arrangement?.numHatches],
        render: (ctx) => <ArrangementStep {...ctx} />,
        summary: arrSummary,
        complete: arrComplete,
      },
      {
        id: "availability",
        title: "Availability",
        hint: "Status, open port, dates, zone.",
        mand: [(s) => !!s.availability?.status, (s) => !!s.availability?.openPort?.locode, (s) => !!s.availability?.openFrom],
        opt: [(s) => !!s.availability?.charterType, (s) => !!s.availability?.wog, (s) => !!s.availability?.direction],
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
        complete: perfComplete,
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
        opt: [
          (s) => (s.gear?.geared ? !!s.gear.grabs : null),
          (s) => (s.gear?.geared ? !!s.gear.numGrabs : null),
          (s) => (s.gear?.geared ? !!s.gear.kickPlate : null),
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
    onSubmit: async (state) => {
      const result = await submitVesselPosition(state);
      router.refresh();
      return result.ref ? `Position ${result.ref} posted for matching` : "Position posted for matching";
    },
    assistant: ({ applyPatch }) => <BosunVesselPanel onApplyVessel={applyPatch} />,
  };

  return <LedgerShell config={config} />;
}
