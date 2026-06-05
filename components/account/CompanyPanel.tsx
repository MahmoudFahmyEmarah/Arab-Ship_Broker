"use client";

// Account → Company tab. Shows the user's company membership and lets them
// search the seeded registry and request to join. Requests are PENDING until a
// platform admin approves — joining a company grants access to that firm's
// confidential vessel records, so it is never self-granted.
import * as React from "react";
import { Building2, Check, Clock, Search, X } from "lucide-react";
import {
  searchOrganizations,
  getMyMembership,
  requestOrgMembership,
  type OrgSearchResult,
  type MyMembership,
} from "@/app/(dashboard)/dashboard/account/company-actions";

const TYPE_LABEL: Record<string, string> = {
  owner: "Owner", charterer: "Charterer", broker: "Broker",
  operator: "Operator", manager: "Ship Manager", other: "Company",
};

function StatusBadge({ status }: { status: MyMembership["status"] }) {
  const map = {
    active: { cls: "bg-green-50 text-green-700 border-green-200", icon: Check, label: "Active member" },
    pending: { cls: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock, label: "Pending approval" },
    rejected: { cls: "bg-asb-gray-100 text-asb-gray-500 border-asb-gray-200", icon: X, label: "Not approved" },
  }[status];
  const Icon = map.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full border ${map.cls}`}>
      <Icon className="w-3 h-3" /> {map.label}
    </span>
  );
}

export function CompanyPanel() {
  const [membership, setMembership] = React.useState<MyMembership | null | undefined>(undefined);
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<OrgSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    getMyMembership().then(setMembership).catch(() => setMembership(null));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  // Debounced registry search.
  React.useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchOrganizations(q)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function join(orgId: string) {
    setSubmitting(orgId);
    setError(null);
    const res = await requestOrgMembership(orgId);
    setSubmitting(null);
    if (!res.ok) { setError(res.error ?? "Request failed"); return; }
    setQ("");
    setResults([]);
    refresh();
  }

  const active = membership && membership.status === "active";

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-asb-navy">Your company</h2>
        <p className="text-asb-gray-500 text-sm mt-1">
          Subscription tier and the marketplace desk live on your company, not your
          personal account. Connect to your firm to act on its behalf.
        </p>
      </div>

      {/* Current membership */}
      {membership === undefined ? (
        <div className="text-sm text-asb-gray-400">Loading…</div>
      ) : membership ? (
        <div className="bg-white border border-asb-gray-200 rounded p-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-asb-blue-light flex items-center justify-center">
              <Building2 className="w-4.5 h-4.5 text-asb-blue" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-asb-navy truncate">{membership.org_name}</div>
              <div className="text-xs text-asb-gray-500">
                {TYPE_LABEL[membership.org_type] ?? "Company"} · {membership.member_role}
              </div>
            </div>
            <div className="ml-auto"><StatusBadge status={membership.status} /></div>
          </div>
          {membership.status === "pending" && (
            <p className="text-xs text-asb-gray-500 mt-3 pt-3 border-t border-asb-gray-100">
              Your request is awaiting confirmation by Arab ShipBroker. You&apos;ll get
              access to your company&apos;s desk and fleet once approved.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-asb-gray-50 border border-dashed border-asb-gray-200 rounded p-5 text-sm text-asb-gray-500">
          You&apos;re not connected to a company yet. Search for your firm below.
        </div>
      )}

      {/* Search + request (hidden once active) */}
      {!active && (
        <div className="bg-white border border-asb-gray-200 rounded p-5 space-y-4">
          <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider">
            {membership ? "Change company" : "Find your company"}
          </p>
          <div className="relative">
            <Search className="w-4 h-4 text-asb-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the company registry…"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-asb-gray-200 rounded focus:border-asb-blue focus:outline-none"
            />
          </div>

          {error && <div className="text-xs text-red-600">{error}</div>}

          <div className="divide-y divide-asb-gray-100">
            {searching && <div className="py-3 text-sm text-asb-gray-400">Searching…</div>}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <div className="py-3 text-sm text-asb-gray-400">
                No match. Your company may not be pre-boarded yet — contact the desk to add it.
              </div>
            )}
            {results.map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-asb-navy truncate">{o.name}</div>
                  <div className="text-xs text-asb-gray-500">
                    {TYPE_LABEL[o.org_type] ?? "Company"}
                    {o.country ? ` · ${o.country}` : ""}
                    {o.fleet_total != null ? ` · ${o.fleet_total} vessel${o.fleet_total === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => join(o.id)}
                  disabled={submitting === o.id}
                  className="ml-auto text-xs font-semibold px-3 py-1.5 rounded border border-asb-blue text-asb-blue hover:bg-asb-blue-light transition-colors disabled:opacity-50"
                >
                  {submitting === o.id ? "Requesting…" : "Request to join"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
