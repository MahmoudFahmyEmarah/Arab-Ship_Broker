"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { subscribeInsights } from "./actions";

export function InsightsEmailCapture() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    const res = await subscribeInsights(email.trim());
    setState(res.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-foam-700">
        <Check className="w-4 h-4" /> You&apos;re on the list — the next edition lands Monday.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Email address"
        className="flex-1 min-w-0 h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm text-ocean-950 placeholder:text-slate-400 focus:outline-none focus:border-ocean-400"
      />
      <button
        type="submit"
        disabled={state === "loading"}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl bg-ocean-600 text-white font-semibold text-sm hover:bg-ocean-700 transition-colors disabled:opacity-60"
      >
        {state === "loading" ? "Adding…" : "Email me the weekly"}
        <ArrowRight className="w-4 h-4" />
      </button>
      {state === "error" && (
        <span className="text-xs text-red-500 max-sm:text-center">Couldn&apos;t add that — check the address.</span>
      )}
    </form>
  );
}
