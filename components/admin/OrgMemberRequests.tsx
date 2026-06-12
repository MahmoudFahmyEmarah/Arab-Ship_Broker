"use client";

import * as React from "react";
import { Building2, Check, X } from "lucide-react";
import {
  decideRequest,
  type PendingRequest,
} from "@/app/(admin)/admin/org-members/actions";

export function OrgMemberRequests({ initial }: { initial: PendingRequest[] }) {
  const [rows, setRows] = React.useState(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const key = (r: PendingRequest) => `${r.org_id}:${r.user_id}`;

  async function decide(r: PendingRequest, approve: boolean, makeAdmin: boolean) {
    setBusy(key(r));
    setError(null);
    const res = await decideRequest(r.org_id, r.user_id, approve, makeAdmin);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "Action failed"); return; }
    setRows((prev) => prev.filter((x) => key(x) !== key(r)));
  }

  if (rows.length === 0) {
    return (
      <div className="dp-card p-8 text-center text-sm text-asb-gray-400">
        No pending membership requests.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-600">{error}</div>}
      {rows.map((r) => (
        <div
          key={key(r)}
          className="dp-card p-4 flex items-center gap-4 flex-wrap"
        >
          <div className="w-9 h-9 rounded bg-asb-blue-light flex items-center justify-center shrink-0">
            <Building2 className="w-4.5 h-4.5 text-asb-blue" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-asb-navy flex items-center gap-2">
              {r.full_name ?? "—"}
              {r.requested_email_domain && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                    r.domain_match
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                  title={r.domain_match
                    ? `Email domain @${r.requested_email_domain} matches this company`
                    : `Email domain @${r.requested_email_domain} does not match a known company domain — verify`}
                >
                  {r.domain_match ? "✓ domain match" : "⚠ domain"}
                </span>
              )}
            </div>
            <div className="text-xs text-asb-gray-500 truncate">{r.email ?? "—"}</div>
          </div>
          <div className="min-w-0 sm:border-l sm:border-asb-gray-100 sm:pl-4">
            <div className="text-xs text-asb-gray-400 uppercase tracking-wider">Requested company</div>
            <div className="text-sm font-medium text-asb-navy truncate">{r.org_name}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => decide(r, true, true)}
              disabled={busy === key(r)}
              className="text-xs font-semibold px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              title="Approve and make this person the company admin"
            >
              <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Approve as admin
            </button>
            <button
              type="button"
              onClick={() => decide(r, true, false)}
              disabled={busy === key(r)}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-asb-blue text-asb-blue hover:bg-asb-blue-light transition-colors disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => decide(r, false, false)}
              disabled={busy === key(r)}
              className="text-xs font-semibold px-3 py-1.5 rounded border border-asb-gray-200 text-asb-gray-500 hover:bg-asb-gray-50 transition-colors disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
