// Broker Ledger — localStorage draft persistence (per prototype behaviour).
// Working state autosaves under `storageKey`; the saved-drafts list lives under
// `${storageKey}.drafts`. Browser-local by design (v1): drafts do not roam
// across devices and clear with site data.

import type { DraftEntry } from "./types";

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

export function loadWorkingState<S>(storageKey: string): S | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as S) : null;
  } catch {
    return null;
  }
}

export function saveWorkingState<S>(storageKey: string, state: S): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* quota/private mode — autosave is best-effort */
  }
}

export function clearWorkingState(storageKey: string): void {
  if (!canStore()) return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

export function loadDrafts<S>(storageKey: string): DraftEntry<S>[] {
  if (!canStore()) return [];
  try {
    const raw = window.localStorage.getItem(`${storageKey}.drafts`);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveDrafts<S>(storageKey: string, drafts: DraftEntry<S>[]): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(`${storageKey}.drafts`, JSON.stringify(drafts));
  } catch {
    /* ignore */
  }
}
