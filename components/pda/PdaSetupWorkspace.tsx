"use client";

// PDA · the Setup tab (owner ruling O2ALL-008, increment D). One home for how the estimator is shown to this member.
// A preference never changes a figure and never hides where a figure came from; it is saved in the member's own
// governed row (set_my_pda_preferences), never in browser storage.
import * as React from "react";
import { Map as MapIcon } from "lucide-react";

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
}: {
  preferences: PdaPreferences;
  onSaved: (next: PdaPreferences) => void;
  onOpenPorts: () => void;
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

  return (
    <section className="pda-setup" aria-labelledby="pda-setup-title">
      <div className="pda-setup__card asb-card">
        <div className="pda-setup__head">
          <h2 id="pda-setup-title">What you see</h2>
          <p>Your own preference, saved to your account. It never changes a figure, and it never hides where a figure came from.</p>
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

        <p className="pda-setup__status" role={save.status === "error" ? "alert" : "status"} aria-live="polite">
          {save.status === "saving" ? "Saving…" : null}
          {save.status === "saved" ? "Saved to your account." : null}
          {save.status === "error" ? save.message : null}
          {save.status === "idle" && !preferences.saved ? "You are seeing the defaults." : null}
        </p>
      </div>

      <div className="pda-setup__card asb-card">
        <div className="pda-setup__head">
          <h2>Port data</h2>
          <p>The records behind every figure in the estimate: each port, its terminals, and the published tariffs that price it.</p>
        </div>
        <button type="button" className="pda-setup__row" onClick={onOpenPorts}>
          <span className="pda-setup__row-icon" aria-hidden="true"><MapIcon size={17} /></span>
          <span className="pda-setup__row-text">
            <b>Ports</b>
            <span>One row per verified port: which services a published tariff prices, the editions in force and the terminals.</span>
          </span>
        </button>
      </div>
    </section>
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
    <div className="pda-setup__pref">
      <div className="pda-setup__pref-text">
        <b id={labelId}>{label}</b>
        <span>{hint}</span>
      </div>
      <div className="pda-setup__seg" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            className={option.id === value ? "is-on" : undefined}
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
