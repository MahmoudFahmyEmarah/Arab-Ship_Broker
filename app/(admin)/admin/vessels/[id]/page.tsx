import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert, Anchor, ExternalLink } from "lucide-react";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  RiskLevelBadge,
  AdminBadge,
  VesselStatusBadge,
  ReviewStatusBadge,
} from "@/components/admin/AdminBadge";
import { VesselIntelControls } from "@/components/admin/vessel/VesselIntelControls";
import type { AdminVesselRow } from "@/lib/admin/types";

type AvailabilityRow = {
  id: string;
  ref: string | null;
  open_port_locode: string | null;
  open_port_name: string | null;
  open_zone: string | null;
  open_date: string | null;
  status: string | null;
  review_status: string | null;
  created_at: string | null;
};

type VesselClaimRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: string | null;
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminVesselDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const adminClient = getSupabaseAdminClient();

  const { data: vessel, error } = await adminClient
    .from("vessels")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !vessel) notFound();
  const v = vessel as AdminVesselRow;

  const { data: availability } = await adminClient
    .from("vessel_availability")
    .select(
      "id, ref, open_port_locode, open_port_name, open_zone, open_date, status, review_status, created_at",
    )
    .eq("vessel_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: claims } = await adminClient
    .from("vessel_claims")
    .select("id, user_id, role, created_at")
    .eq("vessel_id", id);

  const availabilityRows = (availability ?? []) as AvailabilityRow[];
  const claimRows = (claims ?? []) as VesselClaimRow[];

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href="/admin/vessels"
        className="inline-flex items-center gap-1.5 text-sm text-asb-gray-500 hover:text-asb-ink transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Vessel intelligence
      </Link>

      {v.is_sanctioned && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-300 rounded px-4 py-3">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm font-bold text-red-800">
            SANCTIONED — This vessel is hidden from all broker-facing views and
            match results.
          </p>
        </div>
      )}

      <AdminPageHeader
        title={v.vessel_name}
        subtitle={v.imo_number ? `IMO ${v.imo_number}` : "No IMO number"}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="bg-white border border-asb-gray-200 rounded p-6">
            <div className="flex items-center gap-2 flex-wrap mb-5">
              <RiskLevelBadge level={v.risk_level} />
              <AdminBadge variant="neutral" label={v.scope} />
              <AdminBadge variant="neutral" label={v.vessel_type} />
              {v.is_sanctioned && (
                <AdminBadge variant="sanctioned" label="SANCTIONED" />
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                [
                  "DWT Grain",
                  v.dwt_grain ? `${v.dwt_grain.toLocaleString()} MT` : "—",
                ],
                [
                  "DWT Bale",
                  v.dwt_bale ? `${v.dwt_bale.toLocaleString()} MT` : "—",
                ],
                ["Build year", v.build_year?.toString() ?? "—"],
                ["Flag", v.flag ?? "—"],
                ["Flag category", v.flag_category ?? "—"],
                ["Max LOA", v.max_loa_m ? `${v.max_loa_m} m` : "—"],
                ["Max draft", v.max_draft_m ? `${v.max_draft_m} m` : "—"],
                [
                  "Geared",
                  v.is_geared === null ? "—" : v.is_geared ? "Yes" : "No",
                ],
                [
                  "Grain cert",
                  v.grain_certified === null
                    ? "—"
                    : v.grain_certified
                      ? "Yes"
                      : "No",
                ],
                [
                  "DG cert",
                  v.dg_certified === null ? "—" : v.dg_certified ? "Yes" : "No",
                ],
                ["P&I Club", v.pi_club ?? "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] font-bold text-asb-gray-400 uppercase tracking-wider mb-0.5">
                    {label}
                  </p>
                  <p className="text-sm font-semibold text-asb-ink">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Ownership */}
          {(v.owner_company || v.manager_company) && (
            <div className="bg-white border border-asb-gray-200 rounded p-5">
              <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
                Ownership
              </p>
              <div className="grid grid-cols-2 gap-4">
                {v.owner_company && (
                  <InfoCell
                    label="Owner"
                    value={`${v.owner_company}${v.owner_country ? `, ${v.owner_country}` : ""}`}
                  />
                )}
                {v.manager_company && (
                  <InfoCell
                    label="Manager"
                    value={`${v.manager_company}${v.manager_country ? `, ${v.manager_country}` : ""}`}
                  />
                )}
              </div>
            </div>
          )}

          {v.risk_notes && (
            <div className="bg-amber-50 border border-amber-200 rounded p-5">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">
                Risk notes
              </p>
              <p className="text-sm text-amber-800 leading-relaxed">
                {v.risk_notes}
              </p>
            </div>
          )}

          {v.notes && (
            <div className="bg-white border border-asb-gray-200 rounded p-5">
              <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-1">
                Admin notes
              </p>
              <p className="text-sm text-asb-gray-700 leading-relaxed whitespace-pre-wrap">
                {v.notes}
              </p>
            </div>
          )}

          {/* Claims */}
          {claimRows.length > 0 && (
            <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
              <div className="px-5 py-3.5 border-b border-asb-gray-100">
                <p className="text-sm font-bold text-asb-ink-soft">
                  Registered by
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {claimRows.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div>
                      <p className="text-xs font-semibold text-asb-ink-soft font-mono">
                        {c.user_id}
                      </p>
                      <p className="text-[11px] text-asb-gray-400 capitalize">
                        {c.role} · {fmt(c.created_at)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/users?q=${c.user_id}`}
                      className="text-xs font-semibold text-asb-blue hover:text-asb-blue flex items-center gap-1"
                    >
                      View user <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
            <div className="px-5 py-3.5 border-b border-asb-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Anchor className="w-4 h-4 text-asb-gray-400" />
                <p className="text-sm font-bold text-asb-ink-soft">
                  Availability postings
                </p>
              </div>
              <span className="text-xs text-asb-gray-400">
                {availabilityRows.length}
              </span>
            </div>
            {availabilityRows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-asb-gray-400">
                No availability posted
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {availabilityRows.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between px-5 py-3 hover:bg-asb-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <ReviewStatusBadge
                          status={a.review_status ?? "pending"}
                        />
                        <VesselStatusBadge status={a.status ?? "open"} />
                        <Link
                          href={`/admin/vessel-availability/${a.id}`}
                          className="text-[11px] font-mono text-asb-gray-400 hover:text-asb-blue"
                        >
                          {a.ref ?? "—"}
                        </Link>
                      </div>
                      <p className="text-xs text-asb-gray-700">
                        {a.open_port_name && a.open_port_locode ? (
                          <Link
                            href={`/dashboard/ports/${a.open_port_locode}`}
                            className="font-semibold text-asb-ink-soft hover:text-asb-blue hover:underline"
                          >
                            {a.open_port_name}
                          </Link>
                        ) : (
                          (a.open_port_name ?? "?")
                        )}{" "}
                        ({a.open_zone ?? "?"}) · {a.open_date ?? "?"} ·{" "}
                        {fmt(a.created_at)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/vessel-availability/${a.id}`}
                      className="text-asb-gray-400 group-hover:text-asb-blue shrink-0 ml-3 transition-colors"
                      aria-label="Open availability"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <VesselIntelControls vessel={v} />
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-asb-gray-400 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-sm font-medium text-asb-ink-soft">{value}</p>
    </div>
  );
}
