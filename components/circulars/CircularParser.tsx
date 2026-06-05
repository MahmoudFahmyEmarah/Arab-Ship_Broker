"use client";

import { useState } from "react";
import { AlertTriangle, Sparkles, Loader2, Ship, Package } from "lucide-react";
import type { CircularParseResult } from "@/lib/circulars/types";

const EXAMPLE = `CARGO:
3000 mt Wheat. POL Alexandria EGALY. POD Jeddah SAJED. L/C 1-5 Jun. FIOST SSHEX. Frt $45/mt. 2.5% comm. SF 1.30. WOG.

VESSEL:
MV ATLAS STAR. 8200 DWT / 7500 DWCC. Built 2008 Panama flag. Gearless. Open Aegean SPOT. 23.5 MT VLSFO sea. Nia DNR.`;

function FieldGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    return <p className="text-sm text-asb-gray-500">No fields extracted.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-asb-gray-100 py-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-asb-gray-500">
            {k.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm font-medium text-asb-ink text-right">
            {Array.isArray(v) ? v.join(", ") : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CircularParser() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CircularParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/circulars/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Parse failed");
      } else {
        setResult(data as CircularParseResult);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isWog = result?.extracted?.is_wog === true;
  const confidencePct =
    result != null ? Math.round((result.confidence ?? 0) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="rounded border border-asb-gray-200 bg-white p-4 shadow-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            "Paste any email or WhatsApp circular here.\n\nExamples:\n\n" + EXAMPLE
          }
          className="w-full resize-y rounded-lg border border-asb-gray-200 p-3 text-sm font-mono text-asb-ink outline-none focus:border-asb-blue  focus:ring-asb-blue/40"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setText(EXAMPLE)}
            className="text-xs text-asb-gray-500 underline hover:text-asb-ink-soft"
          >
            Load example
          </button>
          <button
            type="button"
            onClick={parse}
            disabled={loading || text.trim().length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-asb-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-asb-blue disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {loading ? "Parsing…" : "Parse circular"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4 rounded border border-asb-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {result.kind === "vessel" ? (
                <Ship className="h-5 w-5 text-asb-blue" />
              ) : result.kind === "cargo" ? (
                <Package className="h-5 w-5 text-asb-blue" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-asb-gray-400" />
              )}
              <span className="text-sm font-semibold capitalize text-asb-ink">
                {result.kind}
              </span>
            </div>
            <span className="text-xs font-medium text-asb-gray-500">
              Confidence {confidencePct}%
            </span>
          </div>

          {result.raw_intent && (
            <p className="text-sm italic text-asb-gray-700">{result.raw_intent}</p>
          )}

          {isWog && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              WOG — Without Guarantee. This offer is not firm.
            </div>
          )}

          {result.warnings?.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-asb-gray-50 p-3 text-sm text-asb-gray-700">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-asb-gray-400">
              Extracted fields
            </h3>
            <FieldGrid
              data={(result.extracted ?? {}) as Record<string, unknown>}
            />
          </div>

          <p className="border-t border-asb-gray-100 pt-3 text-xs text-asb-gray-400">
            Review the extracted data, then create the listing from the{" "}
            {result.kind === "vessel" ? "Post Position" : "Post Cargo"} form. The
            listing goes through the normal review queue before going live.
          </p>
        </div>
      )}
    </div>
  );
}
