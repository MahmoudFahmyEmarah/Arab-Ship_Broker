"use client";

// Data quality console — the tab shell. Screen and filters live in the URL
// (?tab=…&table=…&view=…&rule=…&run=…) so every number on the Overview can
// deep-link into Rules or Issues and a run in progress survives navigation.
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DqBootstrap } from "@/app/(admin)/admin/data-quality/actions";
import { getDqBootstrap } from "@/app/(admin)/admin/data-quality/actions";
import { ConfirmDialog, useToast, type ConfirmSpec } from "./ui";
import { OverviewView } from "./OverviewView";
import { RulesView } from "./RulesView";
import { RunWizard } from "./RunWizard";
import { RunProgress } from "./RunProgress";
import { RunsView } from "./RunsView";
import { IssuesView } from "./IssuesView";
import { AiView } from "./AiView";
import { GateView } from "./GateView";
import { PortsView } from "./PortsView";
import { SettingsView } from "./SettingsView";

export type Screen = "overview" | "rules" | "runs" | "issues" | "ai" | "gate" | "ports" | "settings" | "newrun" | "progress";

export interface ConsoleCtx {
  boot: DqBootstrap;
  refreshBoot: () => Promise<void>;
  canEdit: boolean;
  canRun: boolean;
  tableLabel: (t: string) => string;
  nav: (patch: Record<string, string | null | undefined>, replace?: boolean) => void;
  params: URLSearchParams;
  toast: (msg: string, undo?: () => void | Promise<void>) => void;
  confirm: (c: ConfirmSpec) => void;
}
export const ConsoleContext = React.createContext<ConsoleCtx | null>(null);
export function useConsole(): ConsoleCtx { const c = React.useContext(ConsoleContext); if (!c) throw new Error("ConsoleContext missing"); return c; }

const TABS: { id: Screen; label: string; tip: string; countKey?: keyof DqBootstrap["counts"] }[] = [
  { id: "overview", label: "Overview", tip: "Health per table, trend, what changed" },
  { id: "rules", label: "Rules", tip: "Every rule the gate and the audits run", countKey: "rules" },
  { id: "runs", label: "Runs", tip: "History of audit runs and comparisons" },
  { id: "issues", label: "Issues", tip: "Triage table — j/k to move, f fix, i ignore", countKey: "openIssues" },
  { id: "ai", label: "AI suggestions", tip: "Proposed rules and fixes waiting for a human", countKey: "pendingSuggestions" },
  { id: "gate", label: "Gate", tip: "Enforcement per channel and the rejection log" },
  { id: "ports", label: "Ports registry", tip: "UN/LOCODE version, drift and exceptions" },
  { id: "settings", label: "Settings", tip: "Batch size, AI budget, schedules, weights, access" },
];

export function DataQualityConsole({ boot: initial }: { boot: DqBootstrap }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [boot, setBoot] = React.useState(initial);
  const [confirm, setConfirm] = React.useState<ConfirmSpec | null>(null);
  const { toast, node: toastNode } = useToast();

  const screen = (params.get("tab") as Screen) || "overview";
  const nav = React.useCallback((patch: Record<string, string | null | undefined>, replace = false) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") next.delete(k); else next.set(k, v); }
    const url = `${pathname}${next.toString() ? `?${next}` : ""}`;
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }, [params, pathname, router]);

  const refreshBoot = React.useCallback(async () => { const r = await getDqBootstrap(); if (r.success) setBoot(r.data); }, []);
  const labels = React.useMemo(() => new Map(boot.tables.map((t) => [t.table_name, t.label])), [boot.tables]);
  const ctx: ConsoleCtx = React.useMemo(() => ({
    boot, refreshBoot, canEdit: boot.canEdit, canRun: boot.canRun, tableLabel: (t) => labels.get(t) ?? t, nav, params, toast, confirm: setConfirm,
  }), [boot, refreshBoot, labels, nav, params, toast]);

  const activeTab = screen === "progress" ? "runs" : screen === "newrun" ? "overview" : screen;

  return (
    <ConsoleContext.Provider value={ctx}>
      {!boot.canEdit && (
        <div className="adm-readonly" style={{ borderRadius: 10, marginTop: -4 }}>
          You have <strong>view-only</strong> access to Data quality. You can run audits and read issues; rule edits and fixes are disabled for your preset.
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginTop: -8 }} className="dq-noprint">
        <button type="button" className="adm-btn" title="Print or save the Overview as PDF for the weekly ops review" onClick={() => { nav({ tab: "overview" }); /* the overview loads its data after the route change (audit U12) */ setTimeout(() => window.print(), 900); }}>Export overview</button>
        <button type="button" className="adm-btn primary" title="Start a rule-based or AI audit run over a chosen scope" onClick={() => nav({ tab: "newrun" })}>+ New run</button>
      </div>
      <div className="dq-tabs dq-noprint" role="tablist">
        {TABS.map((t) => {
          const n = t.countKey ? boot.counts[t.countKey] : 0;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} className={`adm-tab${activeTab === t.id ? " is-on" : ""}`} title={t.tip} style={{ whiteSpace: "nowrap" }} onClick={() => nav({ tab: t.id, rule: null, issue: null })}>
              {t.label}{n > 0 && <span className="adm-tab__count">{n.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
      {screen === "overview" && <OverviewView />}
      {screen === "rules" && <RulesView />}
      {screen === "newrun" && <RunWizard />}
      {screen === "progress" && <RunProgress />}
      {screen === "runs" && <RunsView />}
      {screen === "issues" && <IssuesView />}
      {screen === "ai" && <AiView />}
      {screen === "gate" && <GateView />}
      {screen === "ports" && <PortsView />}
      {screen === "settings" && <SettingsView />}
      {toastNode}
      <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />
    </ConsoleContext.Provider>
  );
}
