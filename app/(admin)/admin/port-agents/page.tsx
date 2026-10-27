import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { PDA_ROUTE_SERVICE_CODES } from "@/lib/pda/route-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { pdaAdminListAgencies, pdaAdminListQuoteRequests } from "@/sdk/app/pda";

import { recordAgencyQuote, setPortAgent, upsertAgency } from "./actions";

export const dynamic = "force-dynamic";

export default async function PortAgentsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const actor = await requireAdmin({ section: "portagents" });
  const db = getSupabaseAdminClient();
  const params = await searchParams;
  const [agencies, deskRequests, { data: organisations }, { data: ports }] = await Promise.all([
    pdaAdminListAgencies(db, actor.rowId),
    pdaAdminListQuoteRequests(db, actor.rowId),
    db.from("organizations").select("id,name,org_type,country").order("name").limit(1000),
    db.from("ports").select("locode,trade_name,country").eq("is_active", true).eq("is_verified", true).order("trade_name").limit(1000),
  ]);
  const listed = new Set(agencies.map((a) => a.agencyId));

  return <div className="adm-page">
    <AdminPageHeader
      title="Port Agents"
      subtitle="Invite port agencies and list them at the verified ports they attend. Members see only active agencies at active ports in the PDA Agents tab."
      warn={<span>Only agencies <strong>ASB invites</strong> are listed (owner decision). Every change is logged.</span>}
    />
    {params.message && <div className="adm-alert adm-alert--success">{params.message}</div>}
    {params.error && <div className="adm-alert adm-alert--error">{params.error}</div>}

    <div className="adm-grid adm-grid--2">
      <Panel title="Invite an agency">
        <p className="adm-muted">An agency is an organisation on the platform: its staff join it as members and answer quote requests in their agency inbox. Until an agency has an account, record its emailed quotes below.</p>
        <form action={upsertAgency} className="adm-form">
          <select name="orgId" required defaultValue="">
            <option value="">Organisation</option>
            {(organisations ?? []).filter((o) => !listed.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}{o.country ? ` · ${o.country}` : ""}</option>)}
          </select>
          <input name="displayName" required minLength={2} maxLength={200} placeholder="Name members see"/>
          <input name="website" placeholder="https:// website (optional)"/>
          <button type="submit">Invite agency</button>
        </form>
      </Panel>
      <Panel title="List an agency at a port">
        <form action={setPortAgent} className="adm-form">
          <select name="orgId" required defaultValue="">
            <option value="">Agency</option>
            {agencies.map((a) => <option key={a.agencyId} value={a.agencyId}>{a.displayName}{a.status === "suspended" ? " (suspended)" : ""}</option>)}
          </select>
          <select name="portLocode" required defaultValue="">
            <option value="">Verified port</option>
            {(ports ?? []).map((p) => <option key={p.locode} value={p.locode}>{p.trade_name} · {p.locode}</option>)}
          </select>
          <fieldset className="adm-checks">
            <legend>Services it quotes</legend>
            {PDA_ROUTE_SERVICE_CODES.map((code) => <label key={code}><input type="checkbox" name="services" value={code}/> {PDA_SERVICE_LABELS[code]}</label>)}
          </fieldset>
          <input type="hidden" name="active" value="true"/>
          <button type="submit">Save port listing</button>
        </form>
      </Panel>
    </div>

    <Panel title={`Quotes received by email (${deskRequests.length})`}>
      <p className="adm-muted">
        Open member requests addressed to agencies that have no portal account yet. When such an agency answers by email, record
        its quote here on its behalf: it is kept like a portal quote (append-only; a new one is a revision), shown to the member
        as recorded by Arab ShipBroker, and the member is notified. Say where it came from (the email and its date). The member&apos;s
        identity stays masked unless they shared it.
      </p>
      {deskRequests.length === 0 ? <p className="adm-muted">Nothing is waiting.</p> : <div className="adm-version-list">
        {deskRequests.map((item) => <article key={`${item.requestId}-${item.agencyId}`}>
          <div>
            <strong>{item.agencyName} · {item.snapshot.port?.name ?? item.port} ({item.port})</strong>
            <span>
              Call {item.snapshot.callDate ?? "—"} · {item.snapshot.vessel?.type ?? "vessel"}{item.snapshot.vessel?.dwt ? ` · DWT ${item.snapshot.vessel.dwt}` : ""}
              {item.snapshot.vessel?.gt ? ` · GT ${item.snapshot.vessel.gt}` : ""}{item.snapshot.call?.cargoQuantityMt ? ` · ${item.snapshot.call.cargoQuantityMt} MT` : ""}
              {item.snapshot.call?.days ? ` · ${item.snapshot.call.days} d` : ""} · requested by {item.snapshot.requester?.company ?? "a member (identity not shared)"}
            </span>
            <span>Services: {item.services.map((s) => PDA_SERVICE_LABELS[s]).join(", ")} · answer by {item.expiresAt.slice(0, 10)}{item.deskQuotes ? ` · ${item.deskQuotes} quote(s) recorded` : ""}</span>
            {item.note ? <span>Member&apos;s note: {item.note}</span> : null}
          </div>
          <form action={recordAgencyQuote} className="adm-form">
            <input type="hidden" name="requestId" value={item.requestId}/>
            <input type="hidden" name="agencyId" value={item.agencyId}/>
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="adm-inline-forms">
              <input name="lineLabel" placeholder={i === 0 ? "Charge, e.g. Agency fee" : "Charge"} maxLength={200} defaultValue={i < item.services.length ? PDA_SERVICE_LABELS[item.services[i]!] : ""}/>
              <select name="lineService" defaultValue={i < item.services.length ? item.services[i] : ""}>
                <option value="">Other</option>
                {item.services.map((s) => <option key={s} value={s}>{PDA_SERVICE_LABELS[s]}</option>)}
              </select>
              <input name="lineAmount" inputMode="decimal" placeholder="0.00" aria-label={`Amount ${i + 1}`}/>
            </div>)}
            <input name="currency" required maxLength={3} defaultValue="USD" aria-label="Currency"/>
            <input name="validUntil" type="date" required aria-label="Valid until"/>
            <input name="reference" maxLength={120} placeholder="Agency's reference (optional)"/>
            <input name="source" required minLength={3} maxLength={300} placeholder="Source, e.g. Email from ops@agency, 19 Oct 10:42"/>
            <input name="note" maxLength={1000} placeholder="Note to the member (optional)"/>
            <button type="submit">Record quote</button>
          </form>
        </article>)}
      </div>}
    </Panel>

    <Panel title={`Registry (${agencies.length})`}>
      {agencies.length === 0 ? <p className="adm-muted">No agency invited yet.</p> : <div className="adm-version-list">
        {agencies.map((agency) => <article key={agency.agencyId}>
          <div>
            <strong>{agency.displayName}</strong>
            <span>{agency.organisation} · {agency.members} active member{agency.members === 1 ? "" : "s"} · {agency.status}{agency.website ? ` · ${agency.website}` : ""}</span>
            <span>{agency.adminPorts.length ? agency.adminPorts.map((p) => `${p.portName} (${p.status}${p.services.length ? `: ${p.services.map((s) => PDA_SERVICE_LABELS[s]).join(", ")}` : ""})`).join(" · ") : "Not listed at any port yet"}</span>
          </div>
          <div className="adm-inline-forms">
            <form action={upsertAgency}>
              <input type="hidden" name="orgId" value={agency.agencyId}/>
              <input type="hidden" name="displayName" value={agency.displayName}/>
              <input type="hidden" name="website" value={agency.website ?? ""}/>
              <input type="hidden" name="status" value={agency.status === "active" ? "suspended" : "active"}/>
              <button>{agency.status === "active" ? "Suspend" : "Reactivate"}</button>
            </form>
            {agency.adminPorts.filter((p) => p.status === "active").map((p) => <form key={p.portLocode} action={setPortAgent}>
              <input type="hidden" name="orgId" value={agency.agencyId}/>
              <input type="hidden" name="portLocode" value={p.portLocode}/>
              {p.services.map((s) => <input key={s} type="hidden" name="services" value={s}/>)}
              <input type="hidden" name="active" value="false"/>
              <button>Withdraw from {p.portLocode}</button>
            </form>)}
          </div>
        </article>)}
      </div>}
    </Panel>
  </div>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="adm-panel"><h2>{title}</h2>{children}</section>;
}
