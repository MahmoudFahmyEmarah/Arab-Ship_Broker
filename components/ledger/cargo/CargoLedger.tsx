"use client";

// Broker Ledger — Post Cargo page component. Config transcribed from the
// Concept 4 bundle (reference/handoff/mount-config-cargo.jsx); step bodies
// live in ./steps/*.

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { LedgerShell } from "../LedgerShell";
import type { LedgerConfig, LedgerRepost } from "../types";
import { CARGO_STORAGE_KEY, initialCargoState, type CargoState } from "./state";
import { submitCargoLedger } from "./mapState";
import { loadCargoReposts } from "./reposts";
import { CommodityStep, commodityComplete, commoditySummary } from "./steps/CommodityStep";
import { QuantityStep, qtyComplete, qtySummary } from "./steps/QuantityStep";
import { PortsStep, portsComplete, portsSummary } from "./steps/PortsStep";
import { TermsStep, termsComplete, termsSummary } from "./steps/TermsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ForemanPanel } from "../BosunPanel";

export function CargoLedger() {
  const router = useRouter();
  const [reposts, setReposts] = useState<LedgerRepost<CargoState>[]>([]);

  // "Repost a past posting" — the user's recent listings, loaded once.
  useEffect(() => {
    let alive = true;
    loadCargoReposts(getSupabaseBrowserClient())
      .then((r) => alive && setReposts(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
    // SCORING POLICY (keep in sync with the step bodies — every reported
    // inconsistency so far was drift between these lists and the rendered
    // inputs): mand = every *-marked input; opt = EVERY other user-fillable
    // input in the step body. Excluded by design: toggles whose off-state is
    // a valid answer (spot, IAC, WOG, grabs, scrubber…), derived/read-only
    // values (zone from port), and selects that carry a default (freight
    // basis, volume unit counts via mand). Conditional inputs return null
    // (excluded) while their controlling field hides them.
    steps: [
      {
        id: "commodity",
        title: "Commodity",
        hint: "Name + dry/break-bulk.",
        mand: [(s) => !!s.commodity?.name, (s) => !!s.commodity?.form],
        // Deviation from the mount config (user feedback 25 Jul): marketName is
        // auto-derived metadata the user can never fill — counting it capped a
        // fully-entered section at 83%.
        opt: [(s) => !!s.commodity?.packaging],
        render: (ctx) => <CommodityStep {...ctx} />,
        summary: commoditySummary,
        complete: commodityComplete,
      },
      {
        id: "quantity",
        title: "Quantity",
        hint: "Weight/volume + tolerance.",
        // Volume is a required field (stow-check) — the mount config omitted it
        // from mand, letting the % hit 100 while the step was incomplete.
        mand: [(s) => !!s.quantity?.qtyMt, (s) => !!s.quantity?.volume, (s) => !!s.quantity?.unit],
        opt: [(s) => !!s.quantity?.molooPct, (s) => (s.quantity?.molooPct ? !!s.quantity?.optionHolder : null)],
        render: (ctx) => <QuantityStep {...ctx} />,
        summary: qtySummary,
        complete: qtyComplete,
      },
      {
        id: "ports",
        title: "Load & Discharge",
        hint: "POL, POD, rates.",
        mand: [(s) => !!s.ports?.pol?.locode, (s) => !!s.ports?.pod?.locode],
        opt: [
          (s) => !!s.ports?.loadRate,
          (s) => !!s.ports?.dischRate,
          (s) => !!s.ports?.rateMechanism,
          (s) => !!s.ports?.dayExceptions,
          (s) => !!s.ports?.turnTime,
        ],
        render: (ctx) => <PortsStep {...ctx} />,
        summary: portsSummary,
        complete: portsComplete,
      },
      {
        id: "terms",
        title: "Laycan & Terms",
        hint: "Laycan, NOR, freight.",
        // termsComplete also validates the laycan window (order + 45-day cap).
        mand: [(s) => termsComplete(s)],
        opt: [
          (s) => !!s.terms?.laycanTo,
          (s) => !!s.terms?.norClause,
          (s) => !!s.terms?.freight,
          (s) => !!s.terms?.despatch,
          (s) => !!s.terms?.commissionPct,
        ],
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
    reposts,
    onSubmit: async (state) => {
      await submitCargoLedger(state);
      router.refresh();
      return "Cargo posted for matching";
    },
    assistant: ({ applyPatch, revealIncomplete }) => (
      <ForemanPanel mode="cargo" onApplyCargo={applyPatch} onApplied={revealIncomplete} />
    ),
  };

  return <LedgerShell config={config} />;
}
