"use client";

// PDA · the Setup tab (owner ruling O2ALL-008, increment D). One home for how the estimator is shown to this member.
// A preference never changes a figure and never hides where a figure came from; it is saved in the member's own
// governed row (set_my_pda_preferences), never in browser storage.
import * as React from "react";
import Link from "next/link";
import { ChevronRight, FileText, Map as MapIcon, UserRound } from "lucide-react";

import { savePdaPreferences } from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaEstimatorDensity } from "@/lib/pda/estimator-contract";
import {
  PDA_DENSITY_OPTIONS,
  PDA_START_TAB_OPTIONS,
  type PdaPreferences,
  type PdaStartTab,
} from "@/lib/pda/preferences";

type SaveState = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function PdaSetupWorkspace({
  preferences,
  onSaved,
  onOpenPorts,
  onOpenAgents,
}: {
  preferences: PdaPreferences;
  onSaved: (next: PdaPreferences) => void;
  onOpenPorts: () => void;
  onOpenAgents?: () => void;
}) {
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const sequence = React.useRef(0);

  async function persist(density: PdaEstimatorDensity, startTab: PdaStartTab) {
    const run = ++sequence.current;
    setSave({ status: "saving" });
    const result = await savePdaPreferences(density, startTab);
    if (run !== sequence.current) return;
    if (result.ok) {
      onSaved(result.data);
      setSave({ status: "saved" });
    } else {
      setSave({ status: "error", message: result.error });
    }
  }

  // the design's Setup (owner B2ALL-061): cards of preferences and of ways into the port database. A row appears only
  // for a page that exists, so nothing here leads nowhere; more rows arrive with the Ports-module pages.
  return (
    <section className="pe-set" aria-labelledby="pda-setup-title">
      <div className="pe-set-card">
        <div className="pe-set-card__hd">
          <h2 id="pda-setup-title" className="pe-set-card__t">What you see</h2>
          <span>Your own preference, saved to your account. It never changes a figure, and it never hides where a figure came from.</span>
        </div>

        <Choice
          label="Row height"
          hint="Compact fits more of the estimate on one screen."
          name="density"
          value={preferences.density}
          options={PDA_DENSITY_OPTIONS}
          disabled={save.status === "saving"}
          onPick={(density) => void persist(density, preferences.startTab)}
        />
        <Choice
          label="Open the page on"
          hint="A vessel, cargo or port sent from another page always opens the Estimate."
          name="start-tab"
          value={preferences.startTab}
          options={PDA_START_TAB_OPTIONS}
          disabled={save.status === "saving"}
          onPick={(startTab) => void persist(preferences.density, startTab)}
        />

        <p className="pe-set-status" role={save.status === "error" ? "alert" : "status"} aria-live="polite">
          {save.status === "saving" ? "Saving…" : null}
          {save.status === "saved" ? "Saved to your account." : null}
          {save.status === "error" ? save.message : null}
          {save.status === "idle" && !preferences.saved ? "You are seeing the defaults." : null}
        </p>
      </div>

      <div className="pe-set-card">
        <div className="pe-set-card__hd">
          <h2 className="pe-set-card__t">Port database and tariffs</h2>
          <span>The records behind every figure in the estimate. The Ports and Agents tabs above open the same pages.</span>
        </div>
        <div className="pe-set-rows">
          <Row icon={<MapIcon size={17} aria-hidden="true" />} label="Ports" onOpen={onOpenPorts}
            desc="One record per port. Map first, then port by port, with what is known and which tariff prices it." />
          <Link className="pe-set-row" href="/dashboard/ports-da/tariff-packs">
            <span className="pe-set-row__ic"><FileText size={17} aria-hidden="true" /></span>
            <span className="pe-set-row__tx">
              <b>Tariff packs</b>
              <span>One pack per published tariff, under the authority that issued it, and the port-to-packs resolver. Each pack opens its record.</span>
            </span>
            <span className="pe-set-row__go" aria-hidden="true"><ChevronRight size={15} /></span>
          </Link>
          {onOpenAgents ? (
            <Row icon={<UserRound size={17} aria-hidden="true" />} label="Agents and contributions" onOpen={onOpenAgents}
              desc="The agencies Arab ShipBroker has invited, quote requests to them, and their answers." />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Row({ icon, label, desc, onOpen }: { icon: React.ReactNode; label: string; desc: string; onOpen: () => void }) {
  return (
    <button type="button" className="pe-set-row" onClick={onOpen}>
      <span className="pe-set-row__ic">{icon}</span>
      <span className="pe-set-row__tx">
        <b>{label}</b>
        <span>{desc}</span>
      </span>
      <span className="pe-set-row__go" aria-hidden="true"><ChevronRight size={15} /></span>
    </button>
  );
}

function Choice<T extends string>({
  label,
  hint,
  name,
  value,
  options,
  disabled,
  onPick,
}: {
  label: string;
  hint: string;
  name: string;
  value: T;
  options: readonly { id: T; label: string }[];
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  const labelId = `pda-setup-${name}-label`;
  return (
    <div className="pe-set-pref">
      <div className="pe-set-pref__tx">
        <b id={labelId}>{label}</b>
        <span>{hint}</span>
      </div>
      <div className="pe-set-seg" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            className={`pe-set-seg__b${option.id === value ? " is-on" : ""}`}
            disabled={disabled}
            onClick={() => {
              if (option.id !== value) onPick(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
