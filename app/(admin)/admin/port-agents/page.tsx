import type { ReactNode } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PDA_SERVICE_LABELS } from "@/lib/pda/ports-workspace";
import { PDA_ROUTE_SERVICE_CODES } from "@/lib/pda/route-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { pdaAdminListAgencies } from "@/sdk/app/pda";

import { setPortAgent, upsertAgency } from "./actions";

export const dynamic = "force-dynamic";

export default async function PortAgentsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const actor = await requireAdmin({ section: "portagents" });
  const db = getSupabaseAdminClient();
  const params = await searchParams;
  const [agencies, { data: organisations }, { data: ports }] = await Promise.all([
    pdaAdminListAgencies(db, actor.rowId),
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
        <p className="adm-muted">An agency is an organisation on the platform: its staff join it as members and, in the next release, answer quote requests in the portal.</p>
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
