import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

import { attestSource, createDraft, createPublisher, decideStagedRule, publishVersion, recordFxRate, registerSource, replaceRules, returnVersion, stageImport, submitVersion, upsertTerminal, verifyTerminal } from "./actions";

export const dynamic = "force-dynamic";

export default async function PortTariffsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requireAdmin({ section: "porttariffs" });
  const db = getSupabaseAdminClient();
  const params = await searchParams;
  const [{ data: publishers }, { data: sources }, { data: sets }, { data: versions }, { data: staged }, { data: terminals }, { data: fxRates }, { data: attestations }] = await Promise.all([
    db.from("tariff_publishers").select("id,name,publisher_type,country").order("name"),
    db.from("tariff_sources").select("id,title,source_filename,authority,effective_from,sha256").order("registered_at", { ascending: false }).limit(50),
    db.from("port_tariff_sets").select("id,name,port_locode,terminal_id,publisher_id").order("created_at", { ascending: false }).limit(50),
    db.from("port_tariff_versions").select("id,tariff_set_id,version_no,status,currency,effective_from,effective_to,created_by,approved_by,published_at").order("created_at", { ascending: false }).limit(50),
    db.from("tariff_staged_rules").select("id,batch_id,row_no,raw_text,port_locode,source_page,source_sheet,confidence,validation_errors,decision").eq("decision", "pending").order("created_at").limit(30),
    db.from("port_terminals").select("id,port_locode,name,is_verified,created_by").order("port_locode").order("name").limit(100),
    db.from("pda_fx_rates").select("id,base_currency,quote_currency,rate,effective_on,source_kind,source_ref,created_at").order("effective_on", { ascending: false }).order("created_at", { ascending: false }).limit(30),
    db.from("tariff_source_attestations").select("id,source_id,from_authority,to_authority,provenance,attested_at").order("attested_at", { ascending: false }).limit(30),
  ]);
  const unattested = (sources ?? []).filter((s) => s.authority === "reference" || s.authority === "unverified");

  return <div className="adm-page">
    <AdminPageHeader title="Port Tariffs" subtitle="Register evidence, stage extracted tariff rows, and publish deterministic PDA rules through independent maker/checker approval." warn={<span>Uploaded or extracted rates are <strong>never published automatically</strong>. Verify exact port, terminal, effective dates and source evidence.</span>}/>
    {params.message && <div className="adm-alert adm-alert--success">{params.message}</div>}
    {params.error && <div className="adm-alert adm-alert--error">{params.error}</div>}

    <div className="adm-grid adm-grid--2">
      <Panel title="0. Port terminals"><form action={upsertTerminal} className="adm-form">
        <input name="portLocode" required placeholder="UN/LOCODE" maxLength={5}/><input name="name" required placeholder="Terminal name"/><input name="aliases" placeholder="Aliases, comma separated"/><button type="submit">Save for verification</button>
      </form><div className="adm-version-list">{(terminals ?? []).map((terminal) => <article key={terminal.id}><div><strong>{terminal.port_locode} · {terminal.name}</strong><span>{terminal.is_verified ? "Verified" : "Awaiting independent verification"}</span></div>{!terminal.is_verified && <form action={verifyTerminal}><input type="hidden" name="terminalId" value={terminal.id}/><button>Verify as checker</button></form>}</article>)}</div></Panel>
      <Panel title="1. Publisher"><form action={createPublisher} className="adm-form">
        <input name="name" required placeholder="Publisher name"/><select name="publisherType" defaultValue="port_authority"><option value="port_authority">Port authority</option><option value="terminal">Terminal</option><option value="agent">Agent</option><option value="statutory">Statutory</option><option value="other">Other</option></select><input name="country" placeholder="Country"/><input name="website" placeholder="Website"/><button type="submit">Save publisher</button>
      </form></Panel>
      <Panel title="2. Evidence source"><form action={registerSource} className="adm-form">
        <select name="publisherId" required><option value="">Publisher</option>{(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input name="title" required placeholder="Document title"/><input name="sourceFilename" required placeholder="Original filename"/><input name="mimeType" required placeholder="application/pdf"/><input name="sha256" required minLength={64} maxLength={64} placeholder="SHA-256"/><select name="authority" defaultValue="unverified"><option value="unverified">Unverified</option><option value="reference">Reference only</option><option value="agent">Agent-issued</option><option value="official">Official</option><option value="statutory">Statutory</option></select><input name="effectiveFrom" type="date"/><input name="effectiveTo" type="date"/><input name="sourceUri" placeholder="Source URL"/><input name="storagePath" placeholder="Controlled storage path"/><input name="language" placeholder="Language"/><textarea name="currentnessNote" placeholder="Currentness / verification note"/><button type="submit">Register evidence</button>
      </form></Panel>
      <Panel title="3. Stage extracted rows"><form action={stageImport} className="adm-form">
        <select name="sourceId" required><option value="">Registered source</option>{(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.title} · {s.authority}</option>)}</select><input name="extractor" defaultValue="admin-json"/><textarea name="rowsJson" required rows={9} defaultValue={'[{"rawText":"Pilotage per GT…","sourcePage":"4","confidence":0.92,"portLocode":"TRMER","normalizedProposal":{"code":"pilotage","basis":"per_gt","rate":0},"validationErrors":[]}]'}/><button type="submit">Stage only</button>
      </form></Panel>
      <Panel title="4. Create tariff draft"><form action={createDraft} className="adm-form">
        <input name="tariffSetId" placeholder="Existing tariff set UUID (optional)"/><input name="portLocode" required placeholder="UN/LOCODE" maxLength={5}/><input name="terminalId" placeholder="Verified terminal UUID (optional)"/><select name="publisherId" required><option value="">Publisher</option>{(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input name="name" required placeholder="Tariff set name"/><select name="scope" defaultValue="port_call"><option value="port_call">Port call</option><option value="terminal">Terminal</option><option value="pilotage">Pilotage</option><option value="towage">Towage</option><option value="agency">Agency</option><option value="other">Other</option></select><input name="versionNo" required type="number" min="1" defaultValue="1"/><input name="currency" required maxLength={3} placeholder="USD"/><input name="effectiveFrom" required type="date"/><input name="effectiveTo" type="date"/><select name="roundingMode" defaultValue="half_up"><option value="half_up">Half up</option><option value="up">Up</option><option value="down">Down</option></select><input name="decimalPlaces" type="number" min="0" max="6" defaultValue="2"/><select name="primarySourceId" required><option value="">Primary source</option>{(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.title} · {s.authority}</option>)}</select><input name="supersedesId" placeholder="Superseded version UUID (for overlap)"/><textarea name="notes" placeholder="Review notes"/><button type="submit">Create draft</button>
      </form></Panel>
    </div>

    <Panel title="Source provenance">
      <p className="adm-muted">A tariff can only be published from official, agent-issued or statutory evidence. When you learn where a reference or unverified document came from, record it here: who supplied or issued it, when, and how. Its authority is raised once, never lowered, and every record is kept. The checker reads it before publishing.</p>
      <form action={attestSource} className="adm-form">
        <select name="sourceId" required><option value="">Reference / unverified source</option>{unattested.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.authority}</option>)}</select>
        <select name="authority" required defaultValue="agent"><option value="agent">Agent-issued</option><option value="official">Official</option><option value="statutory">Statutory</option></select>
        <textarea name="provenance" required minLength={20} maxLength={2000} placeholder="Provenance: who supplied or issued the document, when, and how (e.g. emailed by our İzmir agent on 3 Oct 2026)"/>
        <button type="submit">Record provenance</button>
      </form>
      <div className="adm-version-list">{(attestations ?? []).length === 0 ? <p className="adm-muted">No provenance recorded yet.</p> : (attestations ?? []).map((a) => { const src = (sources ?? []).find((s) => s.id === a.source_id); return <article key={a.id}><div><strong>{src?.title ?? a.source_id}</strong><span>{a.from_authority} → {a.to_authority} · {new Date(a.attested_at).toISOString().slice(0, 10)} · {a.provenance}</span></div></article>; })}</div>
    </Panel>

    <Panel title="FX rates for PDA display">
      <p className="adm-muted">Append-only. The route estimator converts a tariff currency into the display currency only with a governed rate effective on or before the call date and no older than 31 days; otherwise the leg stays &quot;FX rate required&quot;. A rate is never edited: record a newer date instead.</p>
      <form action={recordFxRate} className="adm-form">
        <input name="baseCurrency" required maxLength={3} placeholder="Base (tariff) currency, e.g. EUR"/><input name="quoteCurrency" required maxLength={3} placeholder="Quote (display) currency, e.g. USD"/>
        <input name="rate" required type="number" step="0.00000001" min="0.00000001" placeholder="1 base = … quote"/><input name="effectiveOn" required type="date"/>
        <select name="sourceKind" defaultValue="ecb"><option value="ecb">ECB reference rate</option><option value="central_bank">Central bank</option><option value="agent">Agent-quoted</option><option value="manual">Manual</option></select><input name="sourceRef" required minLength={3} maxLength={300} placeholder="Source reference (publication, date, URL)"/>
        <button type="submit">Record FX rate</button>
      </form>
      <div className="adm-version-list">{(fxRates ?? []).length === 0 ? <p className="adm-muted">No FX rate recorded yet.</p> : (fxRates ?? []).map((fx) => <article key={fx.id}><div><strong>1 {fx.base_currency} = {fx.rate} {fx.quote_currency}</strong><span>effective {fx.effective_on} · {fx.source_kind.replace("_", " ")} · {fx.source_ref}</span></div></article>)}</div>
    </Panel>

    <Panel title="Pending extracted rows">
      {(staged ?? []).length === 0 ? <p className="adm-muted">No staged rows need a decision.</p> : (staged ?? []).map((row) => <div key={row.id} className="adm-review-row"><div><strong>#{row.row_no} · {row.port_locode ?? "Port mapping required"}</strong><p>{row.raw_text}</p><small>Evidence {row.source_page ? `page ${row.source_page}` : row.source_sheet ? `sheet ${row.source_sheet}` : "missing"} · confidence {row.confidence ?? "—"}</small></div><form action={decideStagedRule}><input type="hidden" name="ruleId" value={row.id}/><input name="note" placeholder="Decision note"/><button name="decision" value="accepted">Accept</button><button name="decision" value="needs_mapping">Needs mapping</button><button name="decision" value="rejected">Reject</button></form></div>)}
    </Panel>

    <Panel title="Draft and publication workflow">
      <form action={replaceRules} className="adm-form adm-form--wide"><select name="versionId" required><option value="">Draft/review version</option>{(versions ?? []).filter((v) => ["draft","in_review"].includes(v.status)).map((v) => <option key={v.id} value={v.id}>{v.id.slice(0,8)} · v{v.version_no} · {v.status}</option>)}</select><textarea name="rulesJson" required rows={10} defaultValue={'[{"code":"port_dues","label":"Port dues","basis":"per_gt","rate":0,"priority":10,"sourceId":"SOURCE-UUID","sourcePage":"4","applicability":{"requestedServices":["port_dues"]},"bands":[]}]'}/><button type="submit">Validate and replace rules</button></form>
      <div className="adm-version-list">{(versions ?? []).map((version) => { const set = (sets ?? []).find((item) => item.id === version.tariff_set_id); return <article key={version.id}><div><strong>{set?.port_locode ?? "—"} · {set?.name ?? version.tariff_set_id}</strong><span>v{version.version_no} · {version.currency} · {version.status} · from {version.effective_from}</span><code>{version.id}</code></div>{version.status === "draft" && <form action={submitVersion}><input type="hidden" name="versionId" value={version.id}/><button>Submit review</button></form>}{version.status === "in_review" && <div><form action={publishVersion}><input type="hidden" name="versionId" value={version.id}/><button>Publish as checker</button></form><form action={returnVersion}><input type="hidden" name="versionId" value={version.id}/><input name="note" required minLength={3} placeholder="Return note"/><button>Return to maker</button></form></div>}</article>})}</div>
    </Panel>
    <style>{` .adm-grid{display:grid;gap:16px;margin:16px 0}.adm-grid--2{grid-template-columns:repeat(2,minmax(0,1fr))}.adm-panel{background:#fff;border:1px solid #d8e1e9;border-radius:10px;padding:16px;margin:16px 0}.adm-panel h2{margin:0 0 12px;font-size:16px}.adm-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.adm-form input,.adm-form select,.adm-form textarea,.adm-review-row input{border:1px solid #ccd7e1;border-radius:6px;padding:8px}.adm-form textarea{grid-column:1/-1}.adm-form button,.adm-review-row button,.adm-version-list button{background:#143f64;color:#fff;border:0;border-radius:6px;padding:9px 12px;font-weight:700}.adm-form--wide{grid-template-columns:1fr}.adm-review-row,.adm-version-list article{display:flex;justify-content:space-between;gap:16px;border-top:1px solid #e3e9ee;padding:12px 0}.adm-review-row p{margin:5px 0}.adm-review-row form{display:flex;gap:5px;align-items:center}.adm-version-list article div{display:grid;gap:3px}.adm-version-list article span,.adm-version-list code,.adm-muted{font-size:12px;color:#6b7d8e}.adm-alert{padding:10px;border-radius:7px;margin:12px 0}.adm-alert--success{background:#edf8e8;color:#356922}.adm-alert--error{background:#feeceb;color:#922f2a}@media(max-width:900px){.adm-grid--2,.adm-form{grid-template-columns:1fr}.adm-review-row{display:grid}.adm-review-row form{flex-wrap:wrap}} `}</style>
  </div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="adm-panel"><h2>{title}</h2>{children}</section>; }
