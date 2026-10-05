import Link from "next/link";
import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/admin/require-admin";
import { canAccess } from "@/lib/admin/sections";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { SUEZ_BASES, SUEZ_CONDITION_KEYS, SUEZ_LAYERS, SUEZ_SURCHARGE_REGIMES } from "@/lib/suez/schemas";
import { SUEZ_VESSEL_CATEGORIES } from "@/lib/suez/types";
import { parseVoyageSettings } from "@/lib/voyage/schemas";
import { DEFAULT_VOYAGE_SETTINGS, type SettingsSource, type VoyageSettings } from "@/lib/voyage/types";

import {
  addSdrRate, citeSource, createVersion, deleteDraftVersion, deleteItem, publishVersion, registerSource, replaceTiers,
  saveItem, saveVoyageSettings, setEcaZoneActive, unciteSource, updateVersionWindow, upsertEcaZone, voidSdrRate, withdrawVersion,
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
  { id: "events", label: "Events" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type VersionRow = { id: string; versionNo: number; status: string; effectiveFrom: string; effectiveTo: string | null; sourceRef: string; sourceUrl: string | null; notes: string | null; createdAt: string; publishedAt: string | null; itemCount: number; tierCount: number ; surchargeRegime?: string; surchargeCount?: number; sourceCount?: number };
type ItemRow = { id: string; code: string; label_en: string; label_ar: string | null; layer: string; basis: string; currency: string; params: Record<string, unknown>; direction_scope: string; cargo_status_scope: string; condition_key: string | null; payer_party: string; sort_order: number; is_active: boolean; notes: string | null ; category_scope?: string[] | null; confidence?: string };
type TierRow = { id: string; vessel_category: string; cargo_status: string; tier_order: number; scnt_from: number; scnt_to: number | null; sdr_per_scnt: number; confidence: string };
type SdrRow = { id: string; rate_usd: number; as_of: string; source: string; notes: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
type EcaRow = { code: string; name: string; polygon: unknown[]; sulphur_limit_pct: number; effective_from: string; effective_to: string | null; is_active: boolean; notes: string | null; geometry_version: string; confidence: string; source_ref: string | null; source_url: string | null; sha256: string | null };
type SourceRow = { id: string; title: string; issuer: string; document_no: string | null; issue_date: string | null; effective_from: string | null; authority: string; evidence_status: string; sha256: string | null; source_filename: string | null; source_uri: string | null; notes: string | null; registered_at: string };
type EventRow = { id: number; entity: string; entity_id: string | null; version_id: string | null; action: string; actor_user_id: string | null; details: Record<string, unknown>; created_at: string };

export default async function VoyageDataPage({ searchParams }: { searchParams: Promise<{ tab?: string; version?: string; message?: string; error?: string }> }) {
  const admin = await requireAdmin({ section: "voyagedata" });
  const params = await searchParams;
  const tab: TabId = (TABS.find((t) => t.id === params.tab)?.id ?? "suez") as TabId;
  const db = getSupabaseAdminClient();

  const [{ data: versionsJson }, { data: sdr }, { data: settingsRow }, { data: eca }, { data: sources }, { data: events }] = await Promise.all([
    db.rpc("admin_list_suez_tariff_versions"),
    db.from("sdr_rates").select("id,rate_usd,as_of,source,notes,created_at,voided_at,void_reason").order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(40),
    db.from("app_settings").select("value").eq("key", "voyage_settings").maybeSingle(),
    db.from("eca_zones").select("code,name,polygon,sulphur_limit_pct,effective_from,effective_to,is_active,notes,geometry_version,confidence,source_ref,source_url,sha256").order("code"),
    db.from("suez_tariff_sources").select("id,title,issuer,document_no,issue_date,effective_from,authority,evidence_status,sha256,source_filename,source_uri,notes,registered_at").order("registered_at", { ascending: false }).limit(100),
    db.from("suez_tariff_events").select("id,entity,entity_id,version_id,action,actor_user_id,details,created_at").order("created_at", { ascending: false }).limit(80),
  ]);
  const versions = ((versionsJson ?? []) as VersionRow[]);
  const selected = versions.find((v) => v.id === params.version) ?? versions.find((v) => v.status === "draft") ?? versions.find((v) => v.status === "published") ?? versions[0] ?? null;
  const [{ data: items }, { data: tiers }, { data: cites }] = selected
    ? await Promise.all([
        db.from("suez_tariff_items").select("*").eq("version_id", selected.id).order("sort_order").order("code"),
        db.from("suez_toll_tiers").select("*").eq("version_id", selected.id).order("vessel_category").order("cargo_status").order("tier_order"),
        db.from("suez_tariff_version_sources").select("source_id").eq("version_id", selected.id),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  // The estimator reads this row through the same validator: a missing or malformed row means compiled defaults and partial estimates.
  const parsedSettings = parseVoyageSettings(settingsRow?.value ?? null);
  const settings: VoyageSettings = parsedSettings.ok ? parsedSettings.value : DEFAULT_VOYAGE_SETTINGS;
  const settingsStatus: SettingsSource = parsedSettings.ok ? "governed" : "defaults";
  const settingsProblem = parsedSettings.ok ? null : settingsRow ? `the stored row is malformed: ${parsedSettings.error}` : "no voyage_settings row exists";
  const canEdit = canAccess("voyagedata", admin.tier, admin.perms) === "edit";
  const hrefFor = (t: TabId, v?: string | null) => `/admin/voyage-data?tab=${t}${v ? `&version=${v}` : ""}`;
  const citedIds = new Set(((cites ?? []) as { source_id: string }[]).map((c) => c.source_id));

  return (
    <div className="adm-page">
      <AdminPageHeader
        title="Voyage estimator data"
        subtitle="Suez tariff versions with their source records, toll bands, the dated SDR rate, the estimator's constants, versioned ECA zones and the fuel feed — everything the calculators read, as governed data with an event trail."
        warn={!canEdit ? "View only: your admin seat cannot edit voyage data." : settingsStatus === "defaults" ? `Voyage constants are not governed (${settingsProblem}); the estimator runs on compiled defaults and marks every estimate partial.` : undefined}
      />
      {params.message && <div className="vd-alert vd-alert--success">{params.message}</div>}
      {params.error && <div className="vd-alert vd-alert--error">{params.error}</div>}

      <nav className="vd-tabs" aria-label="Voyage data sections">
        {TABS.map((t) => <Link key={t.id} href={hrefFor(t.id, selected?.id)} className={`vd-tab${t.id === tab ? " is-active" : ""}`} aria-current={t.id === tab ? "page" : undefined}>{t.label}</Link>)}
      </nav>

      {tab === "suez" && <SuezTab versions={versions} selected={selected} items={(items ?? []) as ItemRow[]} sources={(sources ?? []) as SourceRow[]} citedIds={citedIds} canEdit={canEdit} hrefFor={hrefFor} />}
      {tab === "tiers" && <TiersTab versions={versions} selected={selected} tiers={(tiers ?? []) as TierRow[]} canEdit={canEdit} hrefFor={hrefFor} />}
      {tab === "sdr" && <SdrTab rates={(sdr ?? []) as SdrRow[]} canEdit={canEdit} />}
      {tab === "constants" && <ConstantsTab settings={settings} status={settingsStatus} problem={settingsProblem} canEdit={canEdit} />}
      {tab === "eca" && <EcaTab zones={(eca ?? []) as EcaRow[]} canEdit={canEdit} />}
      {tab === "fuel" && <FuelTab settings={settings} />}
      {tab === "events" && <EventsTab events={(events ?? []) as EventRow[]} versions={versions} />}
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

function EvidenceChip({ status }: { status: string }) {
  return status === "on_file" ? <span className="vd-chip vd-chip--official">on file</span> : <span className="vd-chip vd-chip--pending">document pending</span>;
}

// ── Suez tariff versions, items and source records ──────────────────────────

function SuezTab({ versions, selected, items, sources, citedIds, canEdit, hrefFor }: { versions: VersionRow[]; selected: VersionRow | null; items: ItemRow[]; sources: SourceRow[]; citedIds: Set<string>; canEdit: boolean; hrefFor: (t: TabId, v?: string | null) => string }) {
  const draftSelected = selected?.status === "draft";
  const cited = sources.filter((s) => citedIds.has(s.id));
  const uncited = sources.filter((s) => !citedIds.has(s.id));
  return (
    <>
      <div className="vd-grid vd-grid--2">
        <Panel title="Versions" help="One published version is in force on any date. Published versions are immutable: to change a figure, create a draft from the current version, edit it, then publish it with its own effective date — the previous version closes the day before. Publishing validates every item's params and the bands, and needs at least one cited source record.">
          <div className="vd-list">
            {versions.length === 0 && <p className="vd-muted">No versions yet.</p>}
            {versions.map((v) => (
              <div key={v.id} className="vd-row">
                <div className="vd-row__main">
                  <div className="vd-row__title"><Link href={hrefFor("suez", v.id)} className="adm-link">v{v.versionNo}</Link> <StatusChip status={v.status} /> {selected?.id === v.id && <span className="vd-chip vd-chip--other">selected</span>}</div>
                  <div className="vd-row__meta">{v.effectiveFrom} → {v.effectiveTo ?? "open"} · {v.itemCount} items · {v.tierCount} toll bands{v.tierCount === 0 ? " (toll layer unavailable)" : ""} · surcharges {v.surchargeRegime ?? "unknown"}{v.surchargeRegime === "modelled" ? ` (${v.surchargeCount ?? 0})` : v.surchargeRegime === "unknown" || !v.surchargeRegime ? " (every toll partial)" : ""}</div>
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

        <Panel title="New draft version" help="Copying from an existing version carries its items, toll bands and source citations into the draft; the SCA circular's figures are then edited in place.">
          {canEdit ? (
            <form action={createVersion} className="vd-form">
              <label>Effective from<input type="date" name="effectiveFrom" required /></label>
              <label>Effective to (optional)<input type="date" name="effectiveTo" /></label>
              <label className="vd-span">Source reference<input name="sourceRef" required placeholder="e.g. SCA Circular 3/2026 (tolls), 1 Jul 2026" /></label>
              <label className="vd-span">Source URL (optional)<input name="sourceUrl" placeholder="https://www.suezcanal.gov.eg/…" /></label>
              <label>Copy items, bands and citations from<select name="copyFromVersionId" defaultValue={versions.find((v) => v.status === "published")?.id ?? ""}><option value="">— empty draft —</option>{versions.map((v) => <option key={v.id} value={v.id}>v{v.versionNo} · {v.status} · {v.effectiveFrom}</option>)}</select></label>
              <label>Notes<input name="notes" placeholder="What changed and why" /></label>
              <label className="vd-span">Category surcharges<select name="surchargeRegime" defaultValue="unknown">{SUEZ_SURCHARGE_REGIMES.map((r) => <option key={r} value={r}>{r === "unknown" ? "unknown — not modelled (every toll partial)" : r === "none" ? "none — no surcharge in force for this window" : "modelled — surcharge items carry them"}</option>)}</select></label>
              <div className="vd-span"><button type="submit">Create draft</button></div>
            </form>
          ) : <p className="vd-muted">View only.</p>}
        </Panel>
      </div>

      <div className="vd-grid vd-grid--2">
        <Panel title={selected ? `Sources cited by v${selected.versionNo}` : "Sources"} help="Governed source records: the circular, guide or proforma a version's figures come from, with issuer, document number, dates and the SHA-256 of the document on file. A version cannot publish without one.">
          {!selected && <p className="vd-muted">Select a version.</p>}
          {selected && cited.length === 0 && <p className="vd-alert vd-alert--error">No source record cited: this version cannot be published.</p>}
          {selected && cited.map((s) => (
            <div key={s.id} className="vd-row">
              <div className="vd-row__main">
                <div className="vd-row__title">{s.title} <EvidenceChip status={s.evidence_status} /> <span className="vd-chip vd-chip--other">{s.authority}</span></div>
                <div className="vd-row__meta">{s.issuer}{s.document_no ? ` · ${s.document_no}` : ""}{s.issue_date ? ` · issued ${s.issue_date}` : ""}{s.effective_from ? ` · effective ${s.effective_from}` : ""}</div>
                {s.sha256 && <div className="vd-sha">sha256 {s.sha256}{s.source_filename ? ` · ${s.source_filename}` : ""}</div>}
                {s.notes && <div className="vd-row__meta">{s.notes}</div>}
              </div>
              {canEdit && draftSelected && <form action={unciteSource}><input type="hidden" name="versionId" value={selected.id} /><input type="hidden" name="sourceId" value={s.id} /><button type="submit" className="ghost">Remove citation</button></form>}
            </div>
          ))}
          {selected && canEdit && draftSelected && uncited.length > 0 && (
            <form action={citeSource} className="vd-inline"><input type="hidden" name="versionId" value={selected.id} /><select name="sourceId" aria-label="Source to cite" style={{ maxWidth: 360 }}>{uncited.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.issuer}</option>)}</select><button type="submit" className="ghost">Cite on v{selected.versionNo}</button></form>
          )}
        </Panel>

        <Panel title="Register a source record" help="Record the document before citing it. “On file” needs the SHA-256 of the file as kept in the evidence folder; “document pending” marks figures taken from a reference the owner still has to supply (e.g. a proforma).">
          {canEdit ? (
            <form action={registerSource} className="vd-form">
              {selected && draftSelected && <input type="hidden" name="citeVersionId" value={selected.id} />}
              <label className="vd-span">Title<input name="title" required placeholder="SCA Circular 1/2026 — accompanying charges" /></label>
              <label>Issuer<input name="issuer" required placeholder="Suez Canal Authority" /></label>
              <label>Document no.<input name="documentNo" placeholder="1/2026" /></label>
              <label>Issue date<input type="date" name="issueDate" /></label>
              <label>Effective from<input type="date" name="effectiveFrom" /></label>
              <label>Authority<select name="authority" defaultValue="official"><option value="official">official (SCA / regulator)</option><option value="agent">agent (circular relay, proforma)</option><option value="reference">reference (guide, handbook)</option><option value="owner">owner (ASB ruling)</option></select></label>
              <label>Evidence<select name="evidenceStatus" defaultValue="on_file"><option value="on_file">on file (SHA-256 below)</option><option value="pending_document">document pending</option></select></label>
              <label className="vd-span">SHA-256 of the document<input name="sha256" pattern="[A-Fa-f0-9]{64}" placeholder="64 hex characters (sha256sum file.pdf)" /></label>
              <label>File name<input name="sourceFilename" placeholder="SCA-Circular-1-2026.pdf" /></label>
              <label>URI<input name="sourceUri" placeholder="https://… or evidence/…" /></label>
              <label className="vd-span">Notes<input name="notes" /></label>
              <div className="vd-span"><button type="submit">Register{selected && draftSelected ? ` and cite on v${selected.versionNo}` : ""}</button></div>
            </form>
          ) : <p className="vd-muted">View only.</p>}
          {uncited.length > 0 && <details className="vd-item" style={{ marginTop: 10 }}><summary>All registered sources <span>· {sources.length}</span></summary>{sources.map((s) => <div key={s.id} className="vd-row__meta" style={{ marginTop: 4 }}>{s.title} · {s.issuer}{s.document_no ? ` · ${s.document_no}` : ""} · <EvidenceChip status={s.evidence_status} /></div>)}</details>}
        </Panel>
      </div>

      <Panel title={selected ? `Items of v${selected.versionNo} (${selected.status})` : "Items"} help="Layer: toll (the SCNT toll), surcharge (temporary SCA category surcharge: pct_of_toll {pct}, scoped to vessel categories, laden/ballast and direction; reported = instrument not on file, never trusted), fixed (every transit), conditional (risk flags, applied only when the condition holds), waste (extras). Basis decides how params are read: flat {amount, …thresholds}; pct_of_toll {pct} | {bands:[{key,pct,capSdr}]} | {pctPerUnit,unit}; tier_by_scnt {tiers:[{from,to,amount,includedUnits}]}; per_unit {rate,unit,freeUnits}; gt_threshold {threshold,below,atOrAbove}; flag_only {ageYears?}. Thresholds live here, never in code.">
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
                <div>{it.label_en}{it.label_ar ? ` · ${it.label_ar}` : ""} · scope {it.direction_scope}/{it.cargo_status_scope}{it.category_scope?.length ? ` · categories ${it.category_scope.join(", ")}` : ""}{it.confidence === "reported" ? " · reported" : ""}{it.condition_key ? ` · condition ${it.condition_key}` : ""} · payer {it.payer_party} · sort {it.sort_order}</div>
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
      <label>Vessel categories (none = all)<select name="categoryScope" multiple defaultValue={item?.category_scope ?? []} size={4}>{SUEZ_VESSEL_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <label>Confidence<select name="confidence" defaultValue={item?.confidence ?? "official"}><option value="official">official (instrument on file)</option><option value="reported">reported (relay / press, not trusted)</option></select></label>
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
      <Panel title={selected ? `Toll bands of v${selected.versionNo} (${selected.status})` : "Toll bands"} help="The SCA tolls table: SDR per SCNT, progressive bands per vessel category and laden/ballast. The engine charges each band's tons at its rate and converts the SDR total at the dated SDR rate. Placeholder bands make every toll read “placeholder”, never trusted.">
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
      <Panel title="Replace all bands (CSV paste)" help="One line per band: category, cargo_status, band_no, scnt_from, scnt_to (blank = open), sdr_per_scnt. Categories: dry_bulk, general_cargo, container, tanker_crude, tanker_product, chemical_tanker, lpg, lng, roro, car_carrier, passenger, floating_unit, other. Bands of one category must start at 0, be contiguous and end with an open band (blank scnt_to): a finite last band would stop charging above its ceiling. Only a draft version accepts bands.">
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
  const live = rates.filter((r) => !r.voided_at);
  return (
    <div className="vd-grid vd-grid--2">
      <Panel title="SDR → USD rates" help="The calculator uses the latest live rate dated on or before the transit date; a transit before the earliest rate has no conversion. Rates are append-only: a correction is a new row for the same day, a mistake is voided with a reason — nothing is deleted. Source: IMF daily SDR valuation.">
        {live.length === 0 && <p className="vd-alert vd-alert--error">No SDR rate on file: SDR amounts cannot be converted until one is recorded.</p>}
        <table className="vd-table"><thead><tr><th>As of</th><th className="num">USD per SDR</th><th>Source</th><th>Notes</th><th>Recorded</th>{canEdit && <th />}</tr></thead>
          <tbody>{rates.map((r) => <tr key={r.id} className={r.voided_at ? "vd-struck" : undefined}><td>{r.as_of}{r.voided_at && <> <span className="vd-chip vd-chip--voided">voided</span></>}</td><td className="num">{Number(r.rate_usd).toFixed(6)}</td><td>{r.source}</td><td>{r.voided_at ? `void: ${r.void_reason ?? ""}` : r.notes ?? ""}</td><td>{r.created_at.slice(0, 16).replace("T", " ")}</td>{canEdit && <td>{!r.voided_at && <form action={voidSdrRate}><input type="hidden" name="rateId" value={r.id} /><input name="reason" placeholder="reason" aria-label="Void reason" style={{ width: 140 }} /><button type="submit" className="ghost">Void</button></form>}</td>}</tr>)}</tbody></table>
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

function ConstantsTab({ settings, status, problem, canEdit }: { settings: VoyageSettings; status: SettingsSource; problem: string | null; canEdit: boolean }) {
  const s = settings;
  return (
    <Panel title="Constants & assumptions" help="Defaults the Voyage estimator uses when a vessel or deal does not declare a figure. Every value here is listed as an assumption on the estimate. Saving writes the governed row (and a settings event); the estimator reads it through the same validator.">
      {status === "defaults" && <p className="vd-alert vd-alert--error">Not governed: {problem}. The values below are the compiled defaults; save them to create the governed row.</p>}
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
          <label>ECA main-engine product (0.10 %)<select name="ecaFuelProductKey" defaultValue={s.eca.fuelProductKey}><option>LSMGO</option><option>ULSFO</option><option>MGO05</option><option>MDO</option></select></label>
          <label>Auxiliary distillate product<select name="ecaDistillateProductKey" defaultValue={s.eca.distillateProductKey ?? "LSMGO"}><option>LSMGO</option><option>MGO05</option><option>MDO</option></select></label>
          <label className="vd-span">Sea margin by lane (JSON, e.g. {"{"}&quot;E.MED&gt;AG&quot;: 7{"}"})<textarea name="byLane" defaultValue={JSON.stringify(s.seaMargin.byLane ?? {}, null, 2)} style={{ minHeight: 60 }} /></label>
          <label className="vd-span">Sea margin by season (JSON: winter/spring/summer/autumn)<textarea name="bySeason" defaultValue={JSON.stringify(s.seaMargin.bySeason ?? {}, null, 2)} style={{ minHeight: 60 }} /></label>
          <label className="vd-span">Fuel fallback prices USD/MT, used only when the Fuel Bar has no live index — every such line is labelled “fallback” and the estimate “partial” (JSON by product key)<textarea name="fuelFallback" defaultValue={JSON.stringify(s.fuelFallback, null, 2)} style={{ minHeight: 80 }} /></label>
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
      <Panel title="Emission control areas" help="Rings of [lat, lon] points, each a versioned geometry with its source. A measured route's miles inside a zone in force on the estimate date are priced with the ECA product; saved estimates record the geometry versions they used. The Mediterranean ECA (0.10 %) applies since 1 May 2025.">
        {zones.map((z) => (
          <div key={z.code} className="vd-row">
            <div className="vd-row__main">
              <div className="vd-row__title">{z.code} · {z.name} {z.is_active ? <span className="vd-chip vd-chip--published">active</span> : <span className="vd-chip vd-chip--other">inactive</span>} <span className={`vd-chip ${z.confidence === "official" ? "vd-chip--official" : "vd-chip--pending"}`}>{z.confidence}</span></div>
              <div className="vd-row__meta">geometry {z.geometry_version} · {Array.isArray(z.polygon) ? z.polygon.length : 0} points · sulphur limit {Number(z.sulphur_limit_pct).toFixed(2)} % · {z.effective_from} → {z.effective_to ?? "open"}</div>
              <div className="vd-row__meta">{z.source_ref ?? "no source reference"}{z.source_url ? ` · ${z.source_url}` : ""}{z.notes ? ` · ${z.notes}` : ""}</div>
              {z.sha256 && <div className="vd-sha">sha256 {z.sha256}</div>}
            </div>
            {canEdit && <form action={setEcaZoneActive}><input type="hidden" name="code" value={z.code} /><input type="hidden" name="isActive" value={z.is_active ? "0" : "1"} /><button type="submit" className="ghost">{z.is_active ? "Deactivate" : "Activate"}</button></form>}
          </div>
        ))}
      </Panel>
      <Panel title="Add or replace a zone geometry" help="Replacing a zone's ring is a new geometry version: name it (e.g. MED@2026-10-04), say where it comes from, and give the SHA-256 of the source file for an official geometry. Estimates saved under the previous version keep its name.">
        {canEdit ? (
          <form action={upsertEcaZone} className="vd-form">
            <label>Code<input name="code" required placeholder="MED" pattern="[A-Za-z][A-Za-z0-9_]{1,20}" /></label>
            <label>Name<input name="name" required placeholder="Mediterranean Sea ECA (SOx)" /></label>
            <label>Geometry version<input name="geometryVersion" required placeholder="MED@2026-10-04" pattern="[A-Za-z0-9._@-]{1,40}" /></label>
            <label>Confidence<select name="confidence" defaultValue="coarse"><option value="coarse">coarse (approximate ring)</option><option value="official">official (regulatory boundary, SHA-256 required)</option></select></label>
            <label>Sulphur limit (%)<input type="number" step="0.01" name="sulphurLimitPct" defaultValue={0.1} /></label>
            <label>Active<select name="isActive" defaultValue="1"><option value="1">yes</option><option value="0">no</option></select></label>
            <label>Effective from<input type="date" name="effectiveFrom" required /></label>
            <label>Effective to (optional)<input type="date" name="effectiveTo" /></label>
            <label className="vd-span">Source reference<input name="sourceRef" required placeholder="MEPC.361(79) Annex VI reg. 14 — Mediterranean Sea ECA boundary" /></label>
            <label className="vd-span">Source URL<input name="sourceUrl" placeholder="https://…" /></label>
            <label className="vd-span">SHA-256 of the source file<input name="sha256" pattern="[A-Fa-f0-9]{64}" placeholder="required for an official geometry" /></label>
            <label className="vd-span">Notes<input name="notes" /></label>
            <label className="vd-span">Polygon (JSON array of [lat, lon])<textarea name="polygon" placeholder='[[35.85,-5.6],[36.15,-5.6],…]' style={{ minHeight: 120 }} /></label>
            <div className="vd-span"><button type="submit">Save geometry</button></div>
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
      <Panel title="Fuel price feed" help="The Voyage estimator prices fuel from the Fuel Bar index (the average of live supplier quotes per port and product, delivered as a sealed snapshot). Suppliers, quotes, overrides and freshness are managed on the Bunker ticker page.">
        <p className="vd-muted">Index administration: <Link href="/admin/bunker" className="adm-link">Admin → Bunker ticker</Link>. When no live index exists for a product, the estimator uses the fallback below, labels the line “fallback” and marks the estimate “partial”.</p>
      </Panel>
      <Panel title="Fallback prices (USD/MT)">
        <table className="vd-table"><thead><tr><th>Product</th><th className="num">USD / MT</th></tr></thead>
          <tbody>{Object.entries(settings.fuelFallback).map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td className="num">{Number(v).toLocaleString()}</td></tr>)}</tbody></table>
        <p className="vd-muted" style={{ marginTop: 8 }}>Edit on the Constants &amp; assumptions tab.</p>
      </Panel>
    </div>
  );
}

// ── Events ─────────────────────────────────────────────────────────────────

function EventsTab({ events, versions }: { events: EventRow[]; versions: VersionRow[] }) {
  const vNo = (id: string | null) => (id ? versions.find((v) => v.id === id)?.versionNo : null);
  return (
    <Panel title="Event trail" help="Every write to the Suez tariff data, SDR rates, source records, ECA geometries and the estimator constants, with the acting admin. Version and SDR events are written by the database triggers; the rest by the admin actions.">
      {events.length === 0 && <p className="vd-muted">No events yet.</p>}
      <div className="vd-events">
        <table className="vd-table"><thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Version</th><th>Actor</th><th>Details</th></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><td>{e.created_at.slice(0, 19).replace("T", " ")}</td><td>{e.entity}</td><td>{e.action}</td><td>{vNo(e.version_id) != null ? `v${vNo(e.version_id)}` : e.version_id ? e.version_id.slice(0, 8) : "—"}</td><td>{e.actor_user_id ? e.actor_user_id.slice(0, 8) : "—"}</td><td className="wrap"><code>{JSON.stringify(e.details)}</code></td></tr>)}</tbody></table>
      </div>
    </Panel>
  );
}
