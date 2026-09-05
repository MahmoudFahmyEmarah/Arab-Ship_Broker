"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { MarketVisibilitySettings } from "@/lib/app-settings";
import { savePlatformSettings, saveMarketVisibility } from "@/app/(admin)/admin/settings/actions";
import { ComingSoon } from "@/components/portal/ComingSoon";
// Type-only import: pulling a runtime value from app-settings would drag the
// server-only supabase client (next/headers) into this client bundle.
import type {
  PlatformMode,
  ComingSoonDesign,
  ComingSoonVariant,
  PlatformSettingsData,
} from "@/lib/app-settings";
import "@/components/portal/beta-gate.css";

// ── Static copy (ported from the design's App Settings handoff) ──────────────
const MODES: { id: PlatformMode; short: string }[] = [
  { id: "Live", short: "Full platform open to all users" },
  { id: "Beta", short: "Dashboard open · rest gated" },
  { id: "Test", short: "Sandbox data, internal only" },
  { id: "Maintenance", short: "Offline for non-admins" },
];

const MODE_PILL: Record<PlatformMode, string> = {
  Live: "LIVE — all open",
  Beta: "BETA — gate live",
  Test: "TEST — sandbox",
  Maintenance: "MAINTENANCE — offline",
};

const MODE_NOTE: Record<PlatformMode, string> = {
  Live: "The full platform is open to every signed-up user.",
  Beta: "Every signed-up user can explore and interact with the live Dashboard. All other pages still open, but appear behind a see-through “Coming soon” screen that blocks interaction. You — the signed-in admin — are exempt and keep full access.",
  Test: "The platform runs against sandbox data and is reachable by internal accounts only.",
  Maintenance: "The platform is taken offline for all non-admin users and shows a maintenance message.",
};

// ── AI provider catalogue (ported from the design) ───────────────────────────
type Vendor = { label: string; base: string; keyHint: string; keyPrefix: string; models: string[] };
const VENDORS: Record<string, Vendor> = {
  anthropic: { label: "Anthropic", base: "https://api.anthropic.com", keyHint: "sk-ant-…", keyPrefix: "sk-ant", models: ["claude-opus-4", "claude-sonnet-4", "claude-3-5-sonnet", "claude-3-5-haiku"] },
  openai: { label: "OpenAI", base: "https://api.openai.com/v1", keyHint: "sk-…", keyPrefix: "sk-", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"] },
  google: { label: "Google (Gemini)", base: "https://generativelanguage.googleapis.com", keyHint: "AIza…", keyPrefix: "AIza", models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"] },
  mistral: { label: "Mistral", base: "https://api.mistral.ai/v1", keyHint: "…", keyPrefix: "", models: ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x22b"] },
  azure: { label: "Azure OpenAI", base: "https://<resource>.openai.azure.com", keyHint: "32-char key", keyPrefix: "", models: ["gpt-4o (deployment)", "gpt-4 (deployment)", "gpt-35-turbo (deployment)"] },
  custom: { label: "Custom / self-hosted", base: "", keyHint: "token", keyPrefix: "", models: ["custom-model"] },
};

// Tier access matrix — 1 = yes, 0.5 = partial, 0 = no.
const TIER_ROWS: [string, number, number, number, number][] = [
  ["Post cargo & vessels", 1, 1, 1, 1],
  ["See vessel names + IMO", 0, 0, 1, 1],
  ["Market Partner tag visible", 0, 0.5, 1, 1],
  ["Voyage estimator", 0, 0, 1, 1],
  ["Partner dashboard", 0, 0, 0, 1],
];

type TestStatus = "untested" | "testing" | "ok" | "error";

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`adm-toggle${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
    />
  );
}

// ── Mini design thumbnails (cards) ───────────────────────────────────────────
function MiniRadar() {
  return (
    <div className="adn-mini adn-mini--radar">
      <span className="adn-mini__ring" style={{ inset: "8%" }} />
      <span className="adn-mini__ring" style={{ inset: "30%" }} />
      <span className="adn-mini__sweep" />
    </div>
  );
}

function MiniBeacon() {
  return (
    <div className="adn-mini adn-mini--beacon">
      <span className="adn-mini__pulse" />
      <span className="adn-mini__pulse" style={{ animationDelay: "1s" }} />
      <span className="adn-mini__core" />
    </div>
  );
}

function MiniCompass() {
  return (
    <div className="adn-mini adn-mini--compass">
      <span className="adn-mini__rose" />
      <span className="adn-mini__needle" />
    </div>
  );
}

// Design tile catalogue — the source of truth for the tiles, previews and labels.
const DESIGN_TILES: {
  id: ComingSoonVariant;
  name: string;
  desc: string;
  art: React.ReactNode;
}[] = [
  { id: "radar", name: "Radar", desc: "Sweeping marine radar, cool grey", art: <MiniRadar /> },
  { id: "beacon", name: "Beacon", desc: "Pulsing lighthouse, warm amber", art: <MiniBeacon /> },
  { id: "compass", name: "Compass", desc: "Spinning compass over a sea chart", art: <MiniCompass /> },
];
const DESIGN_NAME: Record<ComingSoonVariant, string> = Object.fromEntries(
  DESIGN_TILES.map((t) => [t.id, t.name]),
) as Record<ComingSoonVariant, string>;

// ── Full-screen preview — renders the REAL ComingSoon overlay ────────────────
function GatePreview({
  variant,
  onClose,
}: {
  variant: ComingSoonVariant;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="asd-preview" role="dialog" aria-modal="true" aria-label="Coming soon preview">
      <div className="asd-preview__scrim" onClick={onClose} />
      <div className="asd-preview__stage">
        <button type="button" className="asd-preview__close" onClick={onClose} aria-label="Close preview">
          ✕ Close preview
        </button>
        <ComingSoon variant={variant} />
      </div>
    </div>,
    document.body,
  );
}

// Keep a design selection non-empty and in canonical (tile) order.
const DESIGN_ORDER = DESIGN_TILES.map((t) => t.id);
function canonicalDesign(sel: ComingSoonVariant[]): ComingSoonDesign {
  const next = DESIGN_ORDER.filter((v) => sel.includes(v));
  return next.length ? next : ["radar"];
}

export function PlatformSettings({
  initialMode,
  initialDesign,
  initialSettings,
  initialVisibility,
  canEdit,
}: {
  initialMode: PlatformMode;
  initialDesign: ComingSoonDesign;
  initialSettings: PlatformSettingsData;
  initialVisibility: MarketVisibilitySettings;
  canEdit: boolean;
}) {
  const [mode, setMode] = React.useState<PlatformMode>(initialMode);
  const [designSel, setDesignSel] = React.useState<ComingSoonDesign>(initialDesign);
  const [preview, setPreview] = React.useState<ComingSoonVariant | null>(null);

  // Persisted form fields.
  const [ai, setAi] = React.useState(initialSettings.ai);
  const [market, setMarket] = React.useState(initialSettings.marketplace);
  const [fields, setFields] = React.useState<Record<string, boolean>>(initialSettings.cardFields);
  const [appearance, setAppearance] = React.useState(initialSettings.appearance ?? { sidebar: "classic" as const });
  // Market freshness — saved to its own app_settings row (the DB RLS gate
  // reads the same row, so this is live enforcement, not just UI defaults).
  const [vis, setVis] = React.useState<MarketVisibilitySettings>(initialVisibility);
  const [visBaseline, setVisBaseline] = React.useState<MarketVisibilitySettings>(initialVisibility);

  // Transient AI-test UI (not persisted).
  const [showKey, setShowKey] = React.useState(false);
  const [status, setStatus] = React.useState<TestStatus>("untested");
  const [msg, setMsg] = React.useState("");
  const V = VENDORS[ai.vendor] ?? VENDORS.anthropic;

  // Baseline = last-saved snapshot. Reset reverts to it; dirty compares to it.
  // Advancing it after a successful save means "Reset" then targets the values
  // we just persisted (the new "current settings").
  const [baseline, setBaseline] = React.useState({
    mode: initialMode,
    design: initialDesign,
    settings: initialSettings,
  });

  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const design = designSel;
  const settings: PlatformSettingsData = { ai, marketplace: market, cardFields: fields, appearance };
  const dirty =
    mode !== baseline.mode ||
    JSON.stringify(design) !== JSON.stringify(baseline.design) ||
    JSON.stringify(settings) !== JSON.stringify(baseline.settings);

  function testKey() {
    const key = ai.apiKey.trim();
    setStatus("testing");
    setMsg("");
    setTimeout(() => {
      if (!key) {
        setStatus("error");
        setMsg("No API key provided.");
        return;
      }
      if (ai.vendor !== "custom" && V.keyPrefix && !key.startsWith(V.keyPrefix)) {
        setStatus("error");
        setMsg(`Key doesn't look like a ${V.label} key (expected ${V.keyHint}).`);
        return;
      }
      if (key.length < 12) {
        setStatus("error");
        setMsg("Key looks too short — check it was copied in full.");
        return;
      }
      const ms = (0.4 + Math.random() * 0.9).toFixed(2);
      setStatus("ok");
      setMsg(`Connected · ${ai.model} responded in ${ms}s.`);
    }, 850);
  }

  // Toggle a design tile, never allowing the last one to switch off.
  function toggleDesign(which: ComingSoonVariant) {
    setSaved(false);
    setDesignSel((sel) => {
      const has = sel.includes(which);
      if (has && sel.length === 1) return sel; // keep at least one on
      const next = has ? sel.filter((v) => v !== which) : [...sel, which];
      return canonicalDesign(next);
    });
  }

  function selectMode(next: PlatformMode) {
    setSaved(false);
    setMode(next);
  }

  function reset() {
    setMode(baseline.mode);
    setDesignSel(baseline.design);
    setAi(baseline.settings.ai);
    setMarket(baseline.settings.marketplace);
    setFields(baseline.settings.cardFields);
    setAppearance(baseline.settings.appearance ?? { sidebar: "classic" });
    setVis(visBaseline);
    setStatus("untested");
    setMsg("");
    setError(null);
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await savePlatformSettings({ mode, design, settings });
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
      const visRes = await saveMarketVisibility(vis);
      if (!visRes.success) {
        setError(visRes.error ?? "Failed to save market freshness");
        return;
      }
      setBaseline({ mode, design, settings });
      setVisBaseline(vis);
      setSaved(true);
    });
  }

  const designLabel =
    design.length === 1
      ? `${DESIGN_NAME[design[0]]} — on every gated page`
      : `${design.map((d) => DESIGN_NAME[d]).join(" · ")} — rotating page to page`;

  return (
    <>
      {/* ── GROUP 1 · PLATFORM STATUS ─────────────────────────────────── */}
      <div className="asd-group">
        <h2 className="asd-group__title">Platform status</h2>
        <p className="asd-group__sub">
          Set the operating mode of the whole platform. Beta mode opens the live Dashboard to
          everyone and gates the rest behind a “Coming soon” screen.
        </p>
        <hr className="asd-group__rule" />

        <div className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">Platform mode</span>
            <span className={`adn-status-pill ${mode === "Beta" ? "is-on" : "is-off"}`}>
              {MODE_PILL[mode]}
            </span>
          </div>

          <div className="asd-mode-grid">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`asd-mode${mode === m.id ? " is-on" : ""}`}
                onClick={() => selectMode(m.id)}
                aria-pressed={mode === m.id}
                disabled={!canEdit}
              >
                <span className="asd-mode__name">{m.id}</span>
                <span className="asd-mode__desc">{m.short}</span>
                {mode === m.id && <span className="asd-mode__check">✓</span>}
              </button>
            ))}
          </div>

          <p className="asd-mode-note">{MODE_NOTE[mode]}</p>

          {/* Beta-only: coming-soon screen design (multi-select → rotates) */}
          {mode === "Beta" && (
            <div className="asd-beta-extra">
              <div className="adn-subhead">Coming-soon screen design</div>
              <div className="adn-design-grid">
                {DESIGN_TILES.map((t) => {
                  const on = design.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      className={`adn-design-tile adn-design-tile--${t.id}${on ? " is-on" : ""}`}
                      onClick={() => canEdit && toggleDesign(t.id)}
                      role="button"
                      aria-pressed={on}
                    >
                      <div className="adn-design-tile__art">{t.art}</div>
                      <div className="adn-design-tile__meta">
                        <span className="adn-design-tile__name">{t.name}</span>
                        <span className="adn-design-tile__desc">{t.desc}</span>
                      </div>
                      {on && <span className="adn-design-tile__check">✓</span>}
                      <button
                        type="button"
                        className="adn-design-tile__preview"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreview(t.id);
                        }}
                      >
                        Preview full screen
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="asd-mode-note" style={{ marginTop: 10 }}>
                Selected: <strong style={{ color: "var(--asb-navy)" }}>{designLabel}</strong>. Pick one to
                apply it to every gated page, or select several to rotate them page by page.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── GROUP 2 · AI & AUTOMATION ─────────────────────────────────── */}
      <div className="asd-group">
        <h2 className="asd-group__title">Appearance</h2>
        <p className="asd-group__sub">
          How the member dashboard looks for every signed-in user. The admin console keeps its own navy rail either way.
        </p>
        <hr className="asd-group__rule" />

        <div className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">Dashboard sidebar</span>
            <span className="adn-status-pill is-on">{appearance.sidebar === "navy" ? "Navy rail" : "Classic white"}</span>
          </div>
          <div className="asd-mode-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            {([
              { id: "classic", name: "Classic", desc: "White rail, grey labels, blue active item — the current look." },
              { id: "navy", name: "Navy", desc: "Navy rail with white labels and a baby-blue active stripe, matching the admin console." },
            ] as const).map((o) => (
              <button key={o.id} type="button" className={`asd-mode${appearance.sidebar === o.id ? " is-on" : ""}`}
                onClick={() => { setSaved(false); setAppearance({ sidebar: o.id }); }} disabled={!canEdit}>
                <span className="asd-mode__name">{o.name}</span>
                <span className="asd-mode__desc">{o.desc}</span>
                {appearance.sidebar === o.id && <span className="asd-mode__check">✓</span>}
              </button>
            ))}
          </div>
          <p className="asd-mode-note">Applies on the next page load for members. You can switch back at any time.</p>
        </div>
      </div>

      <div className="asd-group">
        <h2 className="asd-group__title">AI &amp; automation</h2>
        <p className="asd-group__sub">The model used for AI-assisted analysis across the platform.</p>
        <hr className="asd-group__rule" />

        <div className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">AI provider &amp; model</span>
            <span className="adm-card__sub">Stored securely · never shown to platform users</span>
          </div>
          <div className="adm-settings-grid">
            <div className="adm-field">
              <span className="adm-field__label">Vendor</span>
              <select
                className="adm-select"
                value={ai.vendor}
                disabled={!canEdit}
                onChange={(e) => {
                  const v = e.target.value;
                  setAi((a) => ({ ...a, vendor: v, model: (VENDORS[v] ?? VENDORS.anthropic).models[0] }));
                  setStatus("untested");
                  setMsg("");
                }}
              >
                {Object.entries(VENDORS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <span className="adm-field__label">Model</span>
              <select
                className="adm-select"
                value={ai.model}
                disabled={!canEdit}
                onChange={(e) => {
                  const m = e.target.value;
                  setAi((a) => ({ ...a, model: m }));
                  setStatus("untested");
                  setMsg("");
                }}
              >
                {V.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field" style={{ gridColumn: "1 / -1" }}>
              <span className="adm-field__label">
                {ai.vendor === "azure" || ai.vendor === "custom" ? "Endpoint / base URL" : "Base URL"}
              </span>
              <input
                className="adm-input"
                placeholder={V.base || "https://…"}
                value={ai.baseUrl}
                disabled={!canEdit}
                onChange={(e) => {
                  const baseUrl = e.target.value;
                  setAi((a) => ({ ...a, baseUrl }));
                }}
              />
            </div>
            <div className="adm-field" style={{ gridColumn: "1 / -1" }}>
              <span className="adm-field__label">API key</span>
              <div className="adn-key-row">
                <input
                  className="adm-input adn-key-input"
                  type={showKey ? "text" : "password"}
                  placeholder={V.keyHint}
                  value={ai.apiKey}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const apiKey = e.target.value;
                    setAi((a) => ({ ...a, apiKey }));
                    setStatus("untested");
                    setMsg("");
                  }}
                />
                <button
                  type="button"
                  className="adm-btn small"
                  onClick={() => setShowKey((s) => !s)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="adm-btn primary small adn-test-btn"
                  onClick={testKey}
                  disabled={status === "testing" || !canEdit}
                >
                  {status === "testing" ? "Testing…" : "Test key"}
                </button>
              </div>
              <div className={`adn-test-result is-${status}`}>
                {status === "testing" && (
                  <>
                    <span className="adn-spin" /> Sending a test request to {V.label}…
                  </>
                )}
                {status === "ok" && <>✓ {msg}</>}
                {status === "error" && <>✕ {msg}</>}
                {status === "untested" && <>Run a one-token test call to confirm the key and model respond.</>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── GROUP 3 · MARKETPLACE DEFAULTS ────────────────────────────── */}
      <div className="asd-group">
        <h2 className="asd-group__title">Marketplace defaults</h2>
        <p className="asd-group__sub">
          Platform-wide defaults for listings, tiers, archive windows and commercial terms. (Merged
          from the former Platform settings page.)
        </p>
        <hr className="asd-group__rule" />

        <div className="adm-settings-grid">
          {/* Market freshness — enforced by the database (RLS), not just UI */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Market freshness</span>
              <span className="adn-status-pill is-on">DB-enforced</span>
            </div>
            <div className="adm-settings-grid">
              <div className="adm-field">
                <span className="adm-field__label">Live window (days)</span>
                <input
                  className="adm-input" type="number" min={1} max={60} inputMode="numeric"
                  value={vis.freshDays} disabled={!canEdit}
                  onChange={(e) => setVis((v) => ({ ...v, freshDays: Number(e.target.value) || 0 }))}
                />
                <span style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>
                  Everyone&apos;s default market view — listings posted within this many days.
                  The freshness clock is the POSTING date, never the laycan.
                </span>
              </div>
              {(["T1", "T2", "T3", "T4"] as const).map((t) => (
                <div className="adm-field" key={t}>
                  <span className="adm-field__label">{t} archive reach (days)</span>
                  <input
                    className="adm-input" type="number" min={0} max={365} inputMode="numeric"
                    value={vis.archiveDaysByTier[t]} disabled={!canEdit}
                    onChange={(e) =>
                      setVis((v) => ({
                        ...v,
                        archiveDaysByTier: { ...v.archiveDaysByTier, [t]: Number(e.target.value) || 0 },
                      }))
                    }
                  />
                </div>
              ))}
              <div className="adm-field">
                <span className="adm-field__label">Future-laycan exception</span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: canEdit ? "pointer" : "default" }}>
                  <input
                    type="checkbox" checked={vis.laycanException} disabled={!canEdit}
                    onChange={(e) => setVis((v) => ({ ...v, laycanException: e.target.checked }))}
                  />
                  Keep a listing visible while its laycan / open date is still ahead
                </label>
                <span style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>
                  0 days = that tier sees the live window only. Caps are enforced by the
                  database — a client cannot query past its tier&apos;s reach.
                </span>
              </div>
            </div>
          </div>

          {/* Archive layers */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Archive layers</span>
            </div>
            <div className="adm-settings-grid">
              <div className="adm-field">
                <span className="adm-field__label">Layer 1 (future days)</span>
                <input
                  className="adm-input"
                  value={market.archiveLayer1}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, archiveLayer1: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Layer 2 (recent days)</span>
                <input
                  className="adm-input"
                  value={market.archiveLayer2}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, archiveLayer2: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Layer 3 (months)</span>
                <input
                  className="adm-input"
                  value={market.archiveLayer3}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, archiveLayer3: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Spot cargo active window (days)</span>
                <input
                  className="adm-input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={market.spotActiveDays}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, spotActiveDays: e.target.value }))}
                />
                <span style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>
                  Spot cargoes (no fixed laycan) stay live on the board and in the public
                  “available this week” count for this many days after posting, then age out.
                  Default 14.
                </span>
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Vessel active window (days)</span>
                <input
                  className="adm-input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={market.vesselActiveDays}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, vesselActiveDays: e.target.value }))}
                />
                <span style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>
                  Open vessels with no fixed open date stay live on the board and in the
                  public “open this week” count for this many days after posting, then age
                  out. Vessels with an open date use the ±7-day window. Default 14.
                </span>
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Insights open-position lookback (days)</span>
                <input
                  className="adm-input"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={market.insightsOpenLookbackDays}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setMarket((m) => ({ ...m, insightsOpenLookbackDays: e.target.value }))
                  }
                />
                <span style={{ fontSize: 11, color: "var(--asb-gray-500)", marginTop: 4 }}>
                  Market Insights only: a vessel whose open date falls up to this many days
                  before a report week still counts as “open” that week. Independent of the
                  board’s ±7-day window. Default 14.
                </span>
              </div>
            </div>
          </div>

          {/* Commission & fee defaults */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Commission &amp; fee defaults</span>
            </div>
            <div className="adm-settings-grid">
              <div className="adm-field">
                <span className="adm-field__label">Default broker commission (%)</span>
                <input
                  className="adm-input"
                  value={market.brokerCommission}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, brokerCommission: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Default despatch rate</span>
                <input
                  className="adm-input"
                  value={market.despatchRate}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, despatchRate: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">Default demurrage ($/day)</span>
                <input
                  className="adm-input"
                  value={market.demurrage}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, demurrage: e.target.value }))}
                />
              </div>
              <div className="adm-field">
                <span className="adm-field__label">IAC default</span>
                <select
                  className="adm-select"
                  value={market.iacDefault}
                  disabled={!canEdit}
                  onChange={(e) => setMarket((m) => ({ ...m, iacDefault: e.target.value }))}
                >
                  <option>Included (IAC)</option>
                  <option>Separate</option>
                </select>
              </div>
            </div>
          </div>

          {/* Tier access rules */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Tier access rules</span>
            </div>
            <div className="adm-table">
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>T1</th>
                    <th>T2</th>
                    <th>T3</th>
                    <th>T4</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_ROWS.map(([f, ...vals]) => (
                    <tr key={f as string} className="no-hover">
                      <td>{f}</td>
                      {(vals as number[]).map((v, i) => (
                        <td key={i} style={{ textAlign: "center" }}>
                          {v === 1 ? (
                            <span style={{ color: "var(--asb-green)" }}>✓</span>
                          ) : v === 0.5 ? (
                            <span style={{ color: "var(--asb-amber)" }}>◐</span>
                          ) : (
                            <span style={{ color: "var(--asb-gray-400)" }}>○</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Default card fields */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Default card fields</span>
            </div>
            <p style={{ fontSize: 11, color: "var(--asb-gray-500)", margin: "0 0 8px" }}>
              Fields shown by default on new users&apos; cards. Users can override in their own
              Settings.
            </p>
            {Object.keys(fields).map((f) => (
              <div
                key={f}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  fontSize: 11.5,
                }}
              >
                <span>{f}</span>
                <Toggle
                  on={fields[f]}
                  disabled={!canEdit}
                  onClick={() => setFields((s) => ({ ...s, [f]: !s[f] }))}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Sticky save bar ───────────────────────────────────────────── */}
      <div className="asd-savebar">
        <span className="asd-savebar__note">
          {error ? (
            <span style={{ color: "var(--asb-red)" }}>{error}</span>
          ) : saved && !dirty ? (
            <span style={{ color: "var(--asb-green)" }}>✓ Settings saved to the platform.</span>
          ) : !canEdit ? (
            "View-only access — you cannot change platform settings."
          ) : (
            "Settings persist to the platform when saved."
          )}
        </span>
        <span className="asd-savebar__spacer" />
        <button className="adm-btn" type="button" onClick={reset} disabled={pending || !dirty}>
          Reset
        </button>
        <button
          className="adm-btn primary"
          type="button"
          onClick={save}
          disabled={pending || !dirty || !canEdit}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>

      {preview && <GatePreview variant={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
