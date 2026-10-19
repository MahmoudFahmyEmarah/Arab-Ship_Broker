"use client";

// PDA · saving and the saved-estimate history (owner ruling O2ALL-008, increment A).
//   PdaSaveBar          — "Save estimate" for the route on screen; the server recomputes and saves an immutable set
//   PdaSavedEstimates   — the member's (and their organisation's) saved sets, newest first, each exportable as a PDF
// The page never sends figures to be saved, and only a SAVED set is ever exported.
import * as React from "react";
import { Download, History, Loader2, RefreshCw, Save } from "lucide-react";

import {
  exportPdaEstimateSetPdf,
  listPdaEstimateSets,
  savePdaRouteEstimate,
} from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaEstimateSetSummary, PdaSaveSetResult } from "@/lib/pda/estimate-sets";
import type { PdaRoutePreviewInput, PdaRoutePreviewResult } from "@/lib/pda/route-types";
import { PdaQuoteRequests } from "./PdaQuoteRequests";

function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function money(value: number | null, currency: string): string {
  if (value == null) return "NOT SOURCED";
  return `${currency} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

/** Download a server-rendered PDF (base64) without keeping anything in browser storage. */
export async function downloadSavedEstimatePdf(setId: string): Promise<string | null> {
  const response = await exportPdaEstimateSetPdf(setId);
  if (!response.ok) return response.error;
  const binary = atob(response.data.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = response.data.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return null;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; saved: PdaSaveSetResult }
  | { status: "error"; message: string };

export function PdaSaveBar({
  input,
  totals,
  ready,
  supersedesId,
  onSaved,
}: {
  /** the exact input whose parts are on screen; null until a complete preview exists */
  input: PdaRoutePreviewInput | null;
  /** the totals on screen: the server refuses a save whose recomputation differs */
  totals: PdaRoutePreviewResult["totals"] | null;
  ready: boolean;
  /** the set this session saved last; a new save supersedes it */
  supersedesId: string | null;
  onSaved: (saved: PdaSaveSetResult) => void;
}) {
  const [state, setState] = React.useState<SaveState>({ status: "idle" });
  const [exportError, setExportError] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const generation = React.useRef(0);

  // a changed input invalidates the saved state (design contract: an input change invalidates any save), and an
  // answer to a save started for the previous input is dropped (B2O-044 P2-1)
  React.useEffect(() => {
    generation.current += 1;
    setState({ status: "idle" });
    setExportError("");
  }, [input]);

  async function save() {
    if (!input || !ready) return;
    const run = generation.current;
    setState({ status: "saving" });
    const expected = totals
      ? { loadPortKnown: totals.loadPortKnown, dischargePortKnown: totals.dischargePortKnown, allInKnown: totals.allInKnown, allInComplete: totals.allInComplete }
      : null;
    const response = await savePdaRouteEstimate(input, supersedesId, expected);
    if (run !== generation.current) return;
    if (response.ok) {
      setState({ status: "saved", saved: response.data });
      onSaved(response.data);
    } else {
      setState({ status: "error", message: response.error });
    }
  }

  async function exportPdf(setId: string) {
    setExporting(true);
    setExportError("");
    const failure = await downloadSavedEstimatePdf(setId);
    setExporting(false);
    if (failure) setExportError(failure);
  }

  return (
    <section className="pda-save asb-card" aria-label="Save this estimate">
      <div className="pda-save__text">
        <b>Save this estimate</b>
        <span>
          {ready
            ? "Saves both ports and the route as one record that is never edited. Saving again after a change keeps the earlier version."
            : "Available once both ports, the timeline and the transits are calculated."}
        </span>
      </div>
      <div className="pda-save__actions">
        {state.status === "saved" ? (
          <>
            <span className="pda-save__done" role="status">
              {state.saved.replayed ? "Already saved, unchanged" : "Saved"} · {stamp(state.saved.createdAt)} · fingerprint {state.saved.contentHash.slice(0, 10)}
            </span>
            <button type="button" className="pda-save__button" onClick={() => void exportPdf(state.saved.id)} disabled={exporting}>
              {exporting ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Export PDF
            </button>
          </>
        ) : (
          <button type="button" className="pda-save__button pda-save__button--primary" onClick={() => void save()} disabled={!ready || !input || state.status === "saving"}>
            {state.status === "saving" ? <Loader2 className="is-spinning" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {state.status === "saving" ? "Saving…" : supersedesId ? "Save new version" : "Save estimate"}
          </button>
        )}
      </div>
      {state.status === "error" ? <p className="pda-save__error" role="alert">{state.message}</p> : null}
      {exportError ? <p className="pda-save__error" role="alert">{exportError}</p> : null}
    </section>
  );
}

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: PdaEstimateSetSummary[]; more: boolean };

export function PdaSavedEstimates({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = React.useState<ListState>({ status: "loading" });
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [exportError, setExportError] = React.useState("");
  const sequence = React.useRef(0);
  // the saved estimate whose quote requests are open (Agents phase 2)
  const [openQuotes, setOpenQuotes] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const run = ++sequence.current;
    setState({ status: "loading" });
    const response = await listPdaEstimateSets();
    if (run !== sequence.current) return;
    setState(response.ok ? { status: "ready", items: response.data, more: response.data.length >= 20 } : { status: "error", message: response.error });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function loadMore() {
    if (state.status !== "ready" || !state.items.length) return;
    const run = sequence.current;
    const before = state.items[state.items.length - 1]!.createdAt;
    const response = await listPdaEstimateSets(before);
    // a refresh started meanwhile wins; an older page is dropped (B2O-044 P2-1)
    if (run !== sequence.current) return;
    if (!response.ok) { setExportError(response.error); return; }
    setState((current) => current.status === "ready"
      ? { status: "ready", items: [...current.items, ...response.data.filter((item) => !current.items.some((x) => x.id === item.id))], more: response.data.length >= 20 }
      : current);
  }

  async function exportPdf(setId: string) {
    setBusyId(setId);
    setExportError("");
    const failure = await downloadSavedEstimatePdf(setId);
    setBusyId(null);
    if (failure) setExportError(failure);
  }

  return (
    <section className="pda-history asb-card" aria-labelledby="pda-history-title">
      <div className="pda-history__head">
        <h2 id="pda-history-title"><History size={15} aria-hidden="true" /> Saved estimates</h2>
        <button type="button" className="pda-save__button" onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
      </div>
      {state.status === "loading" ? <p className="pda-history__status" role="status">Loading saved estimates…</p> : null}
      {state.status === "error" ? <p className="pda-save__error" role="alert">{state.message}</p> : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <p className="pda-history__status">Nothing saved yet. A saved estimate keeps both ports, the route and every figure&apos;s source, and can be exported as a PDF.</p>
      ) : null}
      {state.status === "ready" && state.items.length ? (
        <ul className="pda-history__list">
          {state.items.map((item) => (
            <li key={item.id} className={item.isLatest ? undefined : "is-superseded"}>
              <div className="pda-history__main">
                <b>{item.title}</b>
                <span>
                  {stamp(item.createdAt)} · {item.isLatest ? (item.supersedesId ? "latest version" : "latest") : "superseded"}
                  {item.mine ? "" : " · saved by a colleague"}
                </span>
              </div>
              <div className="pda-history__figures">
                <span>All in, known: <b>{money(item.allInKnown, item.displayCurrency)}</b></span>
                <span>{item.notSourcedCount ? `${item.notSourcedCount} not sourced` : "complete"}</span>
              </div>
              <button type="button" className="pda-save__button" onClick={() => void exportPdf(item.id)} disabled={busyId === item.id} aria-label={`Export ${item.title} as PDF`}>
                {busyId === item.id ? <Loader2 className="is-spinning" size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />} PDF
              </button>
              <button type="button" className="pda-save__button" aria-expanded={openQuotes === item.id} onClick={() => setOpenQuotes((id) => (id === item.id ? null : item.id))}>
                Quotes
              </button>
              {openQuotes === item.id ? (
                <PdaQuoteRequests setId={item.id} loadPort={item.loadPort} dischargePort={item.dischargePort} isLatest={item.isLatest} mine={item.mine} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.status === "ready" && state.more ? (
        <button type="button" className="pda-save__button" onClick={() => void loadMore()}>Show older</button>
      ) : null}
      {exportError ? <p className="pda-save__error" role="alert">{exportError}</p> : null}
    </section>
  );
}
