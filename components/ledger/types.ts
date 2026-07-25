// Broker Ledger (Concept 4) — shared shell types.
// Ported from reference/handoff/asb/ledger-shell.jsx + the per-page
// mountBrokerLedger configs. One shell, two page configs (cargo / vessel).

import type { ReactNode } from "react";

/** Whole-state completeness predicate. `null` = not applicable (excluded from
 *  the weighted progress), per the prototype's mand/opt contract. */
export type LedgerPredicate<S> = (state: S) => boolean | null;

export interface StepCtx<S> {
  state: S;
  /** Shallow-merge a patch into the ledger state (prototype `patch`). */
  patch: (update: Partial<S>) => void;
}

export interface LedgerStepDef<S> {
  id: string;
  title: string;
  /** Short hint shown in the collapsed head until the step completes. */
  hint: string;
  /** Mandatory predicates — weight ×2 in the section progress. */
  mand?: LedgerPredicate<S>[];
  /** Optional predicates — weight ×1. */
  opt?: LedgerPredicate<S>[];
  render: (ctx: StepCtx<S>) => ReactNode;
  /** Collapsed-head summary once complete. */
  summary?: (state: S) => string;
  /** Step completeness gate (drives submit). Default true. */
  complete?: (state: S) => boolean;
  /** Display-only "done" for the sidebar check/ring when it must differ from
   *  complete() — e.g. an advisory section that never blocks posting but
   *  should not show as done while empty. */
  progressDone?: (state: S) => boolean;
}

export interface LedgerTemplate<S> {
  name: string;
  sub?: string;
  patch: Partial<S>;
}

export interface LedgerChip<S> {
  label: string;
  patch: Partial<S> | ((state: S) => Partial<S>);
}

export interface LedgerRepost<S> {
  label: string;
  sub?: string;
  patch: Partial<S>;
}

export interface LedgerConfig<S> {
  /** localStorage key for autosave; drafts live under `${storageKey}.drafts`. */
  storageKey: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** ASB Icon name for the header (e.g. "Cargo" | "Vessel"). */
  icon?: string;
  submitLabel: string;
  submitToast?: string;
  /** Where the header Exit link goes. */
  exitHref: string;
  initialState: () => S;
  draftLabel: (state: S) => string;
  steps: LedgerStepDef<S>[];
  /** "Recent values" quick-apply chips in the sidebar. */
  recents?: LedgerChip<S>[];
  /** "Repost a past posting" sidebar rows (loaded from the user's history). */
  reposts?: LedgerRepost<S>[];
  /** Submit handler — maps state → RPC. Throw to keep the draft; resolve to
   *  clear it. Returns an optional success message overriding submitToast. */
  onSubmit: (state: S) => Promise<string | void>;
  /** Optional corner AI assistant (Bosun/Foreman), rendered by the shell. */
  assistant?: (ctx: {
    applyPatch: (p: Partial<S> | ((state: S) => Partial<S>), msg?: string) => void;
    /** Open the first still-incomplete section (design: jump there after an
     *  AI apply so the user lands where their input is needed). */
    revealIncomplete: () => void;
  }) => ReactNode;
}

export interface DraftEntry<S> {
  id: string;
  label: string;
  ts: number;
  doneN: number;
  total: number;
  state: S;
}
