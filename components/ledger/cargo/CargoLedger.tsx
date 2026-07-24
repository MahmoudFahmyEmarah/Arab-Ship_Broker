"use client";

// Broker Ledger — Post Cargo page component. Config transcribed from the
// Concept 4 bundle (reference/handoff/mount-config-cargo.jsx); step bodies
// live in ./steps/*.

import * as React from "react";
import { useRouter } from "next/navigation";
import { LedgerShell } from "../LedgerShell";
import type { LedgerConfig } from "../types";
import { CARGO_STORAGE_KEY, initialCargoState, type CargoState } from "./state";
import { submitCargoLedger } from "./mapState";
import { CommodityStep, commodityComplete, commoditySummary } from "./steps/CommodityStep";
import { QuantityStep, qtyComplete, qtySummary } from "./steps/QuantityStep";
import { PortsStep, portsComplete, portsSummary } from "./steps/PortsStep";
import { TermsStep, termsComplete, termsSummary } from "./steps/TermsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ForemanPanel } from "../BosunPanel";

export function CargoLedger() {
  const router = useRouter();

  const config: LedgerConfig<CargoState> = {
    storageKey: CARGO_STORAGE_KEY,
    eyebrow: "Post Cargo",
    title: "Post a cargo",
    subtitle: "The minimum to match and estimate. The platform classifies the cargo and fills in the rest.",
    icon: "Cargo",
    submitLabel: "Post cargo",
    submitToast: "Cargo posted for matching",
    exitHref: "/dashboard/cargo",
    initialState: initialCargoState,
    draftLabel: (s) => {
      const c = s.commodity;
      const p = s.ports;
      if (c?.name) return c.name + (p?.pol ? " · " + p.pol.name + (p.pod ? " → " + p.pod.name : "") : "");
      return "Untitled cargo";
    },
    steps: [
      {
        id: "commodity",
        title: "Commodity",
        hint: "Name + dry/break-bulk.",
        mand: [(s) => !!s.commodity?.name, (s) => !!s.commodity?.form],
        opt: [(s) => !!s.commodity?.packaging, (s) => !!s.commodity?.marketName],
        render: (ctx) => <CommodityStep {...ctx} />,
        summary: commoditySummary,
        complete: commodityComplete,
      },
      {
        id: "quantity",
        title: "Quantity",
        hint: "Weight/volume + tolerance.",
        mand: [(s) => !!s.quantity?.qtyMt, (s) => !!s.quantity?.unit],
        opt: [(s) => !!s.quantity?.molooPct, (s) => !!s.quantity?.optionHolder],
        render: (ctx) => <QuantityStep {...ctx} />,
        summary: qtySummary,
        complete: qtyComplete,
      },
      {
        id: "ports",
        title: "Load & Discharge",
        hint: "POL, POD, rates.",
        mand: [(s) => !!s.ports?.pol?.name, (s) => !!s.ports?.pod?.name],
        opt: [(s) => !!s.ports?.loadRate, (s) => !!s.ports?.dischRate, (s) => !!s.ports?.rateMechanism],
        render: (ctx) => <PortsStep {...ctx} />,
        summary: portsSummary,
        complete: portsComplete,
      },
      {
        id: "terms",
        title: "Laycan & Terms",
        hint: "Laycan, NOR, freight.",
        mand: [(s) => !!s.terms?.laycanFrom],
        opt: [(s) => !!s.terms?.norClause, (s) => !!s.terms?.freight, (s) => !!s.terms?.commissionPct],
        render: (ctx) => <TermsStep {...ctx} />,
        summary: termsSummary,
        complete: termsComplete,
      },
      {
        id: "review",
        title: "Review",
        hint: "Confirm and post.",
        render: (ctx) => <ReviewStep {...ctx} />,
        summary: () => "Confirm and post",
        complete: (s) => commodityComplete(s) && qtyComplete(s) && portsComplete(s) && termsComplete(s),
      },
    ],
    recents: [
      { label: "MOLOO 10%", patch: (s) => ({ quantity: { ...(s.quantity || {}), molooPct: "10", optionHolder: "MOLOO" } }) },
      { label: "Freight basis: Per MT", patch: (s) => ({ terms: { ...(s.terms || {}), freightBasis: "Per MT" } }) },
      { label: "Commission 3.75%", patch: (s) => ({ terms: { ...(s.terms || {}), commissionPct: "3.75" } }) },
    ],
    onSubmit: async (state) => {
      await submitCargoLedger(state);
      router.refresh();
      return "Cargo posted for matching";
    },
    assistant: ({ applyPatch }) => <ForemanPanel mode="cargo" onApplyCargo={applyPatch} />,
  };

  return <LedgerShell config={config} />;
}
