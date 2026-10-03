import Link from "next/link";
import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SUEZ_BASES, SUEZ_CONDITION_KEYS, SUEZ_LAYERS } from "@/lib/suez/schemas";
import { SUEZ_VESSEL_CATEGORIES } from "@/lib/suez/types";
import { mergeVoyageSettings } from "@/sdk/app/voyage";
import type { VoyageSettings } from "@/lib/voyage/types";

import {
  addSdrRate, createVersion, deleteDraftVersion, deleteItem, deleteSdrRate, publishVersion, replaceTiers,
  saveItem, saveVoyageSettings, setEcaZoneActive, updateVersionWindow, upsertEcaZone, withdrawVersion,
} from "./actions";
import "./voyage-data.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voyage estimator data · Admin" };

const TABS = [
  { id: "suez", label: "Suez tariffs" },
  { id: "tiers", label: "Toll bands" },
  { id: "sdr", label: "SDR rate" },
  { id: "constants", label: "Constants & assumptions" },
  { id: "eca", label: "ECA zones" },
  { id: "fuel", label: "Fuel feed" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type VersionRow = { id: string; versionNo: number; status: string; effectiveFrom: string; effectiveTo: string | null; sourceRef: string; sourceUrl: string | null; notes: string | null; createdAt: string; publishedAt: string | null; itemCount: number; tierCount: number };
type ItemRow = { id: string; code: string; label_en: string; label_ar: string | null; layer: string; basis: string; currency: string; params: Record<string, unknown>; direction_scope: string; cargo_status_scope: string; condition_key: string | null; payer_party: string; sort_order: number; is_active: boolean; notes: string | null };
type TierRow = { id: string; vessel_category: string; cargo_status: string; tier_order: number; scnt_from: number; scnt_to: number | null; sdr_per_scnt: number; confidence: string };
type SdrRow = { id: string; rate_usd: number; as_of: string; source: string; notes: string | null; created_at: string };
type EcaRow = { code: string; name: string; polygon: unknown[]; sulphur_limit_pct: number; effective_from: string; is_active: boolean; notes: string | null };

export default async function VoyageDataPage({ searchParams }: { searchParams: Promise<{ tab?: string; version?: string; message?: string; error?: string }> }) {
  const admin = await requireAdmin({ section: "voyagedata" });
  const params = await searchParams;
  const tab: TabId = (TABS.find((t) => t.id === params.tab)?.id ?? "suez") as TabId;
  const db = getSupabaseAdminClient();

  const [{ data: versionsJson }, { data: sdr }, { data: settingsRow }, { data: eca }] = await Promise.all([
    db.rpc("admin_list_suez_tariff_versions"),
    db.from("sdr_rates").select("id,rate_usd,as_of,source,notes,created_at").order("as_of", { ascending: false }).limit(30),
    db.from("app_settings").select("value").eq("key", "voyage_settings").maybeSingle(),
    db.from("eca_zones").select("code,name,polygon,sulphur_limit_pct,effective_from,is_active,notes").order("code"),
  ]);
  const versions = ((versionsJson ?? []) as VersionRow[]);
  const selected = versions.find((v) => v.id === params.version) ?? versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "published") ?? versions[0] ?? null;
  const [{ data: items }, { data: tiers }] = selected
    ? await Promise.all([
        db.from("suez_tariff_items").select("*").eq("version_id", selected.id).order("sort_order").order("code"),
        db.from("suez_toll_tiers").select("*").eq("version_id", selected.id).order("vessel_category").order("cargo_status").order("tier_order"),
      ])
    : [{ data: [] }, { data: [] }];
  const settings = mergeVoyageSettings((settingsRow?.value ?? null) as Partial<VoyageSettings> | null);
  const canEdit = canAccess("voyagedata", admin.tier, admin.perms) === "edit";
  const hrefFor = (t: TabId, v?: string | null) => `/admin/voyage-data?tab=${t}${v ? `&version=${v}` : ""}`;

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Voyage estimator data"
        subtitle="Suez tariff versions, toll bands, the dated SDR rate, the estimator's constants, ECA zones and the fuel feed — everything the calculators read, as data."
        warn={!canEdit ? "View only: your admin seat cannot edit voyage data." : undefined}
      />
      {params.message && <div className="vd-alert vd-alert--success">{params.message}</div>}
      {params.error && <div className="vd-alert vd-alert--error">{params.error}</div>}

      <nav className="vd-tabs" aria-label="Voyage data sections">
        {TABS.map((t) => <Link key={t.id} href={hrefFor(t.id, selected?.id)} className={`vd-tab${t.id === tab ? " is-active" : ""}`} aria-current={t.id === tab ? "page" : undefined}>{t.label}</Link>)}
      </nav>

      {tab === "suez" && <SuezTab versions={versions} selected={selected} items={(items ?? []) as ItemRow[]} canEdit={canEdit} hrefFor={hrefFor} />}
      {tab === "tiers" && <TiersTab versions={versions} selected={selected} tiers={(tiers ?? []) as TierRow[]} canEdit={canEdit} hrefFor={hrefFor} />}
      {tab === "sdr" && <SdrTab rates={(sdr ?? []) as SdrRow[]} canEdit={canEdit} />}
      {tab === "constants" && <ConstantsTab settings={settings} canEdit={canEdit} />}
      {tab === "eca" && <EcaTab zones={(eca ?? []) as EcaRow[]} canEdit={canEdit} />}
      {tab === "fuel" && <FuelTab settings={settings} />}
    </div>
  );
}

function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <section className="vd-panel"><h2>{title}</h2>{help && <p className="vd-help">{help}</p>}{children}</section>;
}

function StatusChip({ status }: { status: string }) {
  const cls = status === "published" ? "vd-chip--published" : status === "draft" ? "vd-chip--draft" : "vd-chip--other";
  return <span className={`vd-chip ${cls}`}>{status}</span>;
}

// ── Suez tariff versions and items ─────────────────────────────────────────

function SuezTab({ versions, selected, items, canEdit, hrefFor }: { versions: VersionRow[]; selected: VersionRow | null; items: ItemRow[]; canEdit: boolean; hrefFor: (t: TabId, v?: string | null) => string }) {
  const draftSelected = selected?.status === "draft";
  return (
    <>
      <div className="vd-grid vd-grid--2">
        <Panel title="Versions" help="One published version is in force on any date. Published versions are immutable: to change a figure, create a draft from the current version, edit it, then publish it with its own effective date — the previous version closes the day before.">
          <div className="vd-list">
            {versions.length === 0 && <p className="vd-muted">No versions yet.</p>}
            {versions.map((v) => (
              <div key={v.id} className="vd-row">
                <div className="vd-row__main">
                  <div className="vd-row__title"><Link href={hrefFor("suez", v.id)} className="adm-link">v{v.versionNo}</Link> <StatusChip status={v.status} /> {selected?.id === v.id && <span className="vd-chip vd-chip--other">selected</span>}</div>
                  <div className="vd-row__meta">{v.effectiveFrom} → {v.effectiveTo ?? "open"} · {v.itemCount} items · {v.tierCount} toll bands{v.tierCount === 0 ? " (toll layer unavailable)" : ""}</div>
                  <div className="vd-row__meta">{v.sourceRef}{v.notes ? ` — ${v.notes}` : ""}</div>
                </div>
                {canEdit && (
                  <div>
                    {v.status === "draft" && (
                      <form action={publishVersion}><input type="hidden" name="versionId" value={v.id} /><input name="confirm" placeholder="Type PUBLISH" aria-label="Type PUBLISH to confirm" style={{ width: 120 }} /><button type="submit">Publish</button></form>
                    )}
                    {v.status === "draft" && (
                      <form action={deleteDraftVersion}><input type="hidden" name="versionId" value={v.id} /><button type="submit" className="danger">Delete draft</button></form>
                    )}
                    {v.status === "published" && (
                      <form action={updateVersionWindow}><input type="hidden" name="versionId" value={v.id} /><input type="date" name="effectiveTo" defaultValue={v.effectiveTo ?? ""} aria-label="Effective to" /><button type="submit" className="ghost">Close window</button></form>
                    )}
                    {v.status === "published" && (
                      <form action={withdrawVersion}><input type="hidden" name="versionId" value={v.id} /><button type="submit" className="ghost">Withdraw</button></form>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="New draft version" help="Copying from an existing version carries its items and toll bands into the draft; the SCA circular's figures are then edited in place.">
          {canEdit ? (
            <form action={createVersion} className="vd-form">
              <label>Effective from<input type="date" name="effectiveFrom" required /></label>
              <label>Effective to (optional)<input type="date" name="effectiveTo" /></label>
              <label className="vd-span">Source reference<input name="sourceRef" required placeholder="e.g. SCA Circular 3/2026 (tolls), 1 Jul 2026" /></label>
              <label className="vd-span">Source URL (optional)<input name="sourceUrl" placeholder="https://www.suezcanal.gov.eg/…" /></label>
              <label>Copy items and bands from<select name="copyFromVersionId" defaultValue={versions.find((v) => v.status === "published")?.id ?? ""}><option value="">— empty draft —</option>{versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNo} · {v.status} · {v.effectiveFrom}</option>)}</select></label>
              <label>Notes<input name="notes" placeholder="What changed and why" /></label>
              <div className="vd-span"><button type="submit">Create draft</button></div>
            </form>
          ) : <p className="vd-muted">View only.</p>}
        </Panel>
      </div>

      <Panel title={selected ? `Items of v${selected.versionNo} (${selected.status})` : "Items"} help="Layer: toll (the SCNT toll), fixed (every transit), conditional (risk flags, applied only when the condition holds), waste (extras). Basis decides how params are read: flat {amount}; pct_of_toll {pct} | {bands:[{key,pct,capSdr}]} | {pctPerUnit,unit}; tier_by_scnt {tiers:[{from,to,amount,includedUnits}]}; per_unit {rate,unit,freeUnits}; gt_threshold {threshold,below,atOrAbove}; flag_only {}.">
        {!selected && <p className="vd-muted">Select a version.</p>}
        {selected && items.length === 0 && <p className="vd-muted">No items.</p>}
        {selected && items.map((it) => (
          <details key={it.id} className="vd-item">
            <summary>{it.code} <span>· {it.layer} · {it.basis} · {it.currency} · {it.label_en}{it.is_active ? "" : " · inactive"}</span></summary>
            {canEdit && draftSelected ? (
              <>
                <ItemForm versionId={selected.id} item={it} />
                <form action={deleteItem} className="vd-inline"><input type="hidden" name="versionId" value={selected.id} /><input type="hidden" name="itemId" value={it.id} /><button type="submit" className="danger">Delete item</button></form>
              </>
            ) : (
              <div className="vd-row__meta" style={{ marginTop: 6 }}>
                <div>{it.label_en}{it.label_ar ? ` · ${it.label_ar}` : ""} · scope {it.direction_scope}/{it.cargo_status_scope}{it.condition_key ? ` · condition ${it.condition_key}` : ""} · payer {it.payer_party} · sort {it.sort_order}</div>
                <pre style={{ margin: "6px 0 0", fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(it.params)}</pre>
                {it.notes && <div>{it.notes}</div>}
                {!draftSelected && <div style={{ marginTop: 4 }}>Published versions are immutable; create a draft to change this item.</div>}
              </div>
            )}
          </details>
        ))}
        {selected && canEdit && draftSelected && (
          <details className="vd-item"><summary>Add item</summary><ItemForm versionId={selected.id} item={null} /></details>
        )}
      </Panel>
    </>
  );
}

function ItemForm({ versionId, item }: { versionId: string; item: ItemRow | null }) {
  return (
    <form action={saveItem} className="vd-form vd-form--3" style={{ marginTop: 8 }}>
      <input type="hidden" name="versionId" value={versionId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <label>Code<input name="code" defaultValue={item?.code ?? ""} required pattern="[a-z][a-z0-9_]{1,79}" /></label>
      <label>Label (EN)<input name="labelEn" defaultValue={item?.label_en ?? ""} required /></label>
      <label>Label (AR)<input name="labelAr" defaultValue={item?.label_ar ?? ""} dir="rtl" /></label>
      <label>Layer<select name="layer" defaultValue={item?.layer ?? "fixed"}>{SUEZ_LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
      <label>Basis<select name="basis" defaultValue={item?.basis ?? "flat"}>{SUEZ_BASES.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
      <label>Currency<select name="currency" defaultValue={item?.currency ?? "USD"}><option>USD</option><option>SDR</option></select></label>
      <label>Direction scope<select name="directionScope" defaultValue={item?.direction_scope ?? "any"}><option value="any">any</option><option value="SB">SB</option><option value="NB">NB</option></select></label>
      <label>Cargo status scope<select name="cargoStatusScope" defaultValue={item?.cargo_status_scope ?? "any"}><option value="any">any</option><option value="laden">laden</option><option value="ballast">ballast</option></select></label>
      <label>Condition key<select name="conditionKey" defaultValue={item?.condition_key ?? ""}><option value="">— none —</option>{SUEZ_CONDITION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label>Payer<select name="payerParty" defaultValue={item?.payer_party ?? "owner"}><option value="owner">owner</option><option value="charterer">charterer</option><option value="either">either</option></select></label>
      <label>Sort order<input type="number" name="sortOrder" defaultValue={item?.sort_order ?? 100} /></label>
      <label>Active<select name="isActive" defaultValue={item ? (item.is_active ? "1" : "0") : "1"}><option value="1">yes</option><option value="0">no</option></select></label>
      <label className="vd-span">Params (JSON)<textarea name="params" defaultValue={JSON.stringify(item?.params ?? {}, null, 2)} /></label>
      <label className="vd-span">Notes<input name="notes" defaultValue={item?.notes ?? ""} /></label>
      <div className="vd-span vd-inline">
        <button type="submit">{item ? "Save item" : "Add item"}</button>
      </div>
    </form>
  );
}

// ── Toll bands ──────────────────────────────────────────────────────────────

function TiersTab({ versions, selected, tiers, canEdit, hrefFor }: { versions: VersionRow[]; selected: VersionRow | null; tiers: TierRow[]; canEdit: boolean; hrefFor: (t: TabId, v?: string | null) => string }) {
  const draftSelected = selected?.status === "draft";
  const grouped = new Map<string, TierRow[]>();
  for (const t of tiers) { const k = `${t.vessel_category}|${t.cargo_status}`; grouped.set(k, [...(grouped.get(k) ?? []), t]); }
  const csv = tiers.map((t) => `${t.vessel_category},${t.cargo_status},${t.tier_order},${t.scnt_from},${t.scnt_to ?? ""},${t.sdr_per_scnt}`).join("\n");
  const example = "dry_bulk,laden,0,0,5000,8.0000\ndry_bulk,laden,1,5000,10000,6.0000\ndry_bulk,laden,2,10000,20000,4.5000\ndry_bulk,laden,3,20000,,3.0000\ndry_bulk,ballast,0,0,5000,6.8000\n…";
  return (
    <div className="vd-grid vd-grid--2">
      <Panel title={selected ? `Toll bands of v${selected.versionNo} (${selected.status})` : "Toll bands"} help="The SCA tolls table: SDR per SCNT, progressive bands per vessel category and laden/ballast. The engine charges each band's tons at its rate and converts the SDR total at the dated SDR rate.">
        <div className="vd-inline">{versions.map((v) => <Link key={v.id} href={hrefFor("tiers", v.id)} className={`vd-chip ${v.id === selected?.id ? "vd-chip--published" : "vd-chip--other"}`}>v{v.versionNo} · {v.status}</Link>)}</div>
        {tiers.length === 0 && <p className="vd-alert vd-alert--error">No toll bands in this version: the toll layer reports “SCA tolls circular not loaded”. Paste the bands of the SCA circular on the right.</p>}
        {[...grouped.entries()].map(([k, rows]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <div className="vd-row__title">{SUEZ_VESSEL_CATEGORIES.find((c) => c.key === rows[0].vessel_category)?.label ?? rows[0].vessel_category} · {rows[0].cargo_status} {rows.some((r) => r.confidence === "placeholder") && <span className="vd-chip vd-chip--placeholder">placeholder</span>}</div>
            <table className="vd-table"><thead><tr><th>Band</th><th className="num">From SCNT</th><th className="num">To SCNT</th><th className="num">SDR / SCNT</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id}><td>{r.tier_order}</td><td className="num">{Number(r.scnt_from).toLocaleString()}</td><td className="num">{r.scnt_to == null ? "open" : Number(r.scnt_to).toLocaleString()}</td><td className="num">{Number(r.sdr_per_scnt).toFixed(4)}</td></tr>)}</tbody></table>
          </div>
        ))}
      </Panel>
      <Panel title="Replace all bands (CSV paste)" help="One line per band: category, cargo_status, band_no, scnt_from, scnt_to (blank = open), sdr_per_scnt. Categories: dry_bulk, general_cargo, container, tanker_crude, tanker_product, chemical_tanker, lpg, lng, roro, car_carrier, passenger, other. Bands of one category must start at 0 and be contiguous. Only a draft version accepts bands.">
        {canEdit && selected && draftSelected ? (
          <form action={replaceTiers} className="vd-form">
            <input type="hidden" name="versionId" value={selected.id} />
            <label className="vd-span">Bands<textarea name="csv" defaultValue={csv} placeholder={example} style={{ minHeight: 220 }} /></label>
            <label>Confidence<select name="confidence" defaultValue="official"><option value="official">official (from the SCA circular)</option><option value="placeholder">placeholder (flagged in every estimate)</option></select></label>
            <div className="vd-inline"><button type="submit">Replace bands of v{selected.versionNo}</button></div>
          </form>
        ) : <p className="vd-muted">{!selected ? "Select a version." : !draftSelected ? `v${selected.versionNo} is ${selected.status}: create a draft from it on the Suez tariffs tab to load bands.` : "View only."}</p>}
      </Panel>
    </div>
  );
}

// ── SDR rates ──────────────────────────────────────────────────────────────

function SdrTab({ rates, canEdit }: { rates: SdrRow[]; canEdit: boolean }) {
  return (
    <div className="vd-grid vd-grid--2">
      <Panel title="SDR → USD rates" help="The calculator uses the rate dated on or before the transit date (else the earliest on file). Source: IMF daily SDR valuation.">
        {rates.length === 0 && <p className="vd-alert vd-alert--error">No SDR rate on file: SDR amounts cannot be converted until one is recorded.</p>}
        <table className="vd-table"><thead><tr><th>As of</th><th className="num">USD per SDR</th><th>Source</th><th>Notes</th>{canEdit && <th />}</tr></thead>
          <tbody>{rates.map((r) => <tr key={r.id}><td>{r.as_of}</td><td className="num">{Number(r.rate_usd).toFixed(6)}</td><td>{r.source}</td><td>{r.notes ?? ""}</td>{canEdit && <td><form action={deleteSdrRate}><input type="hidden" name="rateId" value={r.id} /><button type="submit" className="ghost">Remove</button></form></td>}</tr>)}</tbody></table>
      </Panel>
      <Panel title="Record a rate">
        {canEdit ? (
          <form action={addSdrRate} className="vd-form">
            <label>As of<input type="date" name="asOf" required /></label>
            <label>USD per SDR<input type="number" step="0.000001" min="0.5" max="5" name="rateUsd" required placeholder="1.36" /></label>
            <label>Source<input name="source" defaultValue="IMF" /></label>
            <label>Notes<input name="notes" placeholder="e.g. IMF representative rate" /></label>
            <div className="vd-span"><button type="submit">Record rate</button></div>
          </form>
        ) : <p className="vd-muted">View only.</p>}
      </Panel>
    </div>
  );
}

// ── Constants & assumptions ─────────────────────────────────────────────────

function ConstantsTab({ settings, canEdit }: { settings: VoyageSettings; canEdit: boolean }) {
  const s = settings;
  return (
    <Panel title="Constants & assumptions" help="Defaults the Voyage estimator uses when a vessel or deal does not declare a figure. Every value here is listed as an assumption on the estimate.">
      <form action={saveVoyageSettings} className="vd-form vd-form--3">
        <fieldset disabled={!canEdit} style={{ display: "contents" }}>
          <label>Default laden speed (kn)<input type="number" step="0.1" name="ladenKn" defaultValue={s.speeds.ladenKn} /></label>
          <label>Default ballast speed (kn)<input type="number" step="0.1" name="ballastKn" defaultValue={s.speeds.ballastKn} /></label>
          <label>Sea margin (%)<input type="number" step="0.5" name="seaMarginPct" defaultValue={s.seaMargin.defaultPct} /></label>
          <label>Default load port days<input type="number" step="0.1" name="loadDefault" defaultValue={s.portTimeDays.loadDefault} /></label>
          <label>Default discharge port days<input type="number" step="0.1" name="dischDefault" defaultValue={s.portTimeDays.dischDefault} /></label>
          <label>Idle share of port time (%)<input type="number" step="1" name="idleSharePct" defaultValue={s.portTimeDays.idleSharePct} /></label>
          <label>Default anchorage days<input type="number" step="0.1" name="anchorageDaysDefault" defaultValue={s.anchorageDaysDefault} /></label>
          <label>Suez transit days<input type="number" step="0.1" name="suezTransitDays" defaultValue={s.suez.transitDays} /></label>
          <label>Suez anchorage / convoy days<input type="number" step="0.1" name="suezAnchorageDays" defaultValue={s.suez.anchorageDays} /></label>
          <label>Suez canal distance (NM)<input type="number" step="1" name="suezNm" defaultValue={s.suez.nm} /></label>
          <label>Crew cost (USD/day, class C)<input type="number" step="1" name="crewUsdDay" defaultValue={s.opex.crewUsdDay} /></label>
          <label>Maintenance (USD/day, class C)<input type="number" step="1" name="maintenanceUsdDay" defaultValue={s.opex.maintenanceUsdDay} /></label>
          <label>Class A multiplier<input type="number" step="0.1" name="classA" defaultValue={s.classMultipliers.A} /></label>
          <label>Class B multiplier<input type="number" step="0.1" name="classB" defaultValue={s.classMultipliers.B} /></label>
          <label>Class C multiplier<input type="number" step="0.1" name="classC" defaultValue={s.classMultipliers.C} /></label>
          <label>ECA fuel product<select name="ecaFuelProductKey" defaultValue={s.eca.fuelProductKey}><option>LSMGO</option><option>ULSFO</option><option>MGO05</option><option>MDO</option></select></label>
          <label className="vd-span">Sea margin by lane (JSON, e.g. {"{"}&quot;E.MED&gt;AG&quot;: 7{"}"})<textarea name="byLane" defaultValue={JSON.stringify(s.seaMargin.byLane ?? {}, null, 2)} style={{ minHeight: 60 }} /></label>
          <label className="vd-span">Sea margin by season (JSON: winter/spring/summer/autumn)<textarea name="bySeason" defaultValue={JSON.stringify(s.seaMargin.bySeason ?? {}, null, 2)} style={{ minHeight: 60 }} /></label>
          <label className="vd-span">Fuel fallback prices USD/MT, used only when the Fuel Bar has no live index (JSON by product key)<textarea name="fuelFallback" defaultValue={JSON.stringify(s.fuelFallback, null, 2)} style={{ minHeight: 80 }} /></label>
          {canEdit && <div className="vd-span"><button type="submit">Save constants</button></div>}
        </fieldset>
      </form>
    </Panel>
  );
}

// ── ECA zones ──────────────────────────────────────────────────────────────

function EcaTab({ zones, canEdit }: { zones: EcaRow[]; canEdit: boolean }) {
  return (
    <div className="vd-grid vd-grid--2">
      <Panel title="Emission control areas" help="Rings of [lat, lon] points. A measured route's miles inside an active zone are priced with the ECA fuel product. The Mediterranean ECA (0.10 %) applies since 1 May 2025.">
        {zones.map((z) => (
          <div key={z.code} className="vd-row">
            <div className="vd-row__main">
              <div className="vd-row__title">{z.code} · {z.name} {z.is_active ? <span className="vd-chip vd-chip--published">active</span> : <span className="vd-chip vd-chip--other">inactive</span>}</div>
              <div className="vd-row__meta">{Array.isArray(z.polygon) ? z.polygon.length : 0} points · sulphur limit {Number(z.sulphur_limit_pct).toFixed(2)} % · from {z.effective_from}{z.notes ? ` · ${z.notes}` : ""}</div>
            </div>
            {canEdit && <form action={setEcaZoneActive}><input type="hidden" name="code" value={z.code} /><input type="hidden" name="isActive" value={z.is_active ? "0" : "1"} /><button type="submit" className="ghost">{z.is_active ? "Deactivate" : "Activate"}</button></form>}
          </div>
        ))}
      </Panel>
      <Panel title="Add or replace a zone">
        {canEdit ? (
          <form action={upsertEcaZone} className="vd-form">
            <label>Code<input name="code" required placeholder="MED" pattern="[A-Za-z][A-Za-z0-9_]{1,20}" /></label>
            <label>Name<input name="name" required placeholder="Mediterranean Sea ECA (SOx)" /></label>
            <label>Sulphur limit (%)<input type="number" step="0.01" name="sulphurLimitPct" defaultValue={0.1} /></label>
            <label>Effective from<input type="date" name="effectiveFrom" required /></label>
            <label>Active<select name="isActive" defaultValue="1"><option value="1">yes</option><option value="0">no</option></select></label>
            <label>Notes<input name="notes" /></label>
            <label className="vd-span">Polygon (JSON array of [lat, lon])<textarea name="polygon" placeholder='[[35.85,-5.6],[36.15,-5.6],…]' style={{ minHeight: 120 }} /></label>
            <div className="vd-span"><button type="submit">Save zone</button></div>
          </form>
        ) : <p className="vd-muted">View only.</p>}
      </Panel>
    </div>
  );
}

// ── Fuel feed ──────────────────────────────────────────────────────────────

function FuelTab({ settings }: { settings: VoyageSettings }) {
  return (
    <div className="vd-grid vd-grid--2">
      <Panel title="Fuel price feed" help="The Voyage estimator prices fuel from the Fuel Bar index (the average of live supplier quotes per port and product). Suppliers, quotes, overrides and freshness are managed on the Bunker ticker page.">
        <p className="vd-muted">Index administration: <Link href="/admin/bunker" className="adm-link">Admin → Bunker ticker</Link>. When no live index exists for a product, the estimator uses the fallback below and says so on every estimate.</p>
      </Panel>
      <Panel title="Fallback prices (USD/MT)">
        <table className="vd-table"><thead><tr><th>Product</th><th className="num">USD / MT</th></tr></thead>
          <tbody>{Object.entries(settings.fuelFallback).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td className="num">{Number(v).toLocaleString()}</td></tr>)}</tbody></table>
        <p className="vd-muted" style={{ marginTop: 8 }}>Edit on the Constants &amp; assumptions tab.</p>
      </Panel>
    </div>
  );
}
