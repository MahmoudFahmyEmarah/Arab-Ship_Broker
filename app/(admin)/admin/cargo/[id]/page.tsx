import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, User } from "lucide-react";
import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReviewStatusBadge, AdminBadge } from "@/components/admin/AdminBadge";
import { CargoStatusControls } from "@/components/admin/cargo/CargoStatusControls";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type CargoListingView = {
  commodity_name: string | null;
  qty_min_mt: number | null;
  qty_max_mt: number | null;
  ref: string | null;
  review_status: string | null;
  status: string | null;
  cargo_type: string | null;
  is_dg_cargo: boolean | null;
  is_grain_cargo: boolean | null;
  is_spot: boolean | null;
  load_port_name: string | null;
  load_port_locode: string | null;
  load_zone: string | null;
  disch_port_name: string | null;
  disch_port_locode: string | null;
  disch_zone: string | null;
  laycan_from: string | null;
  laycan_to: string | null;
  stowage_factor: string | number | null;
  freight_idea_usd_mt: string | number | null;
  load_terms: string | null;
  commission_pct: string | number | null;
  broker: string | null;
  goes_live_at: string | null;
  requires_geared: boolean | null;
  max_vessel_age_yr: number | null;
  max_loa_m: number | null;
  max_draft_m: number | null;
  notes: string | null;
};

type ReviewQueueHistoryItem = {
  id: string;
  status: string;
  action_taken: string | null;
  amendment_detail: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

export default async function AdminCargoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await getAdminSupabaseClient();

  const { data: cargo, error } = await supabase
    .from("cargo_listings")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !cargo) notFound();
  const cl = cargo as CargoListingView;

  // Find owner
  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("owner_user_id, role, owned_from")
    .eq("listing_id", id)
    .eq("listing_type", "cargo")
    .eq("is_current", true)
    .maybeSingle();

  let owner: Record<string, unknown> | null = null;
  if ((ownership as Record<string, unknown> | null)?.owner_user_id) {
    const { data: u } = await supabase
      .from("users")
      .select("id, full_name, email, trust_tier")
      .eq("id", (ownership as Record<string, unknown>).owner_user_id as string,)
      .maybeSingle();
    owner = u;
  }

  const { data: safetyAnswers } = await supabase
    .from("cargo_safety_answers")
    .select("question_key, answer_value")
    .eq("cargo_listing_id", id);

  const { data: queueItems } = await supabase
    .from("review_queue")
    .select(
      "id, status, action_taken, review_reason, amendment_detail, created_at, reviewed_at",
    )
    .eq("listing_id", id)
    .eq("listing_type", "cargo")
    .order("created_at", { ascending: false });

  const queueHistory = (queueItems ?? []) as ReviewQueueHistoryItem[];
  const pendingQueueItemId =
    queueHistory.find((rq) => rq.status === "PENDING")?.id ?? null;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link
        href="/admin/cargo"
        className="inline-flex items-center gap-1.5 text-sm text-asb-gray-500 hover:text-asb-ink transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Cargo listings
      </Link>

      <AdminPageHeader
        title={`${cl.commodity_name as string} — ${(cl.qty_min_mt as number).toLocaleString()}–${(cl.qty_max_mt as number).toLocaleString()} MT`}
        subtitle={cl.ref ? `Ref: ${cl.ref}` : "No ref"}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <ReviewStatusBadge status={cl.review_status as string} />
            <AdminBadge variant="neutral" label={cl.status as string} />
            <AdminBadge variant="neutral" label={cl.cargo_type as string} />
            {(cl.is_dg_cargo as boolean) && (
              <AdminBadge variant="flagged" label="DG" />
            )}
            {(cl.is_grain_cargo as boolean) && (
              <AdminBadge variant="pending" label="Grain" />
            )}
            {(cl.is_spot as boolean) && (
              <AdminBadge variant="approved" label="SPOT" />
            )}
          </div>

          {/* Route */}
          <InfoCard title="Route">
            <Grid2>
              <Cell
                label="Load port"
                value={
                  cl.load_port_name && cl.load_port_locode ? (
                    <span>
                      <Link
                        href={`/dashboard/ports/${cl.load_port_locode}`}
                        className="hover:text-asb-blue hover:underline"
                      >
                        {cl.load_port_name}
                      </Link>
                      <span className="text-asb-gray-400">
                        {` (${cl.load_port_locode})`}
                      </span>
                    </span>
                  ) : (
                    `${cl.load_port_name ?? "—"} (${cl.load_port_locode ?? "—"})`
                  )
                }
              />
              <Cell label="Load zone" value={(cl.load_zone as string) ?? "—"} />
              <Cell
                label="Discharge port"
                value={
                  cl.disch_port_name && cl.disch_port_locode ? (
                    <span>
                      <Link
                        href={`/dashboard/ports/${cl.disch_port_locode}`}
                        className="hover:text-asb-blue hover:underline"
                      >
                        {cl.disch_port_name}
                      </Link>
                      <span className="text-asb-gray-400">
                        {` (${cl.disch_port_locode})`}
                      </span>
                    </span>
                  ) : (
                    `${cl.disch_port_name ?? "—"} (${cl.disch_port_locode ?? "—"})`
                  )
                }
              />
              <Cell
                label="Discharge zone"
                value={(cl.disch_zone as string) ?? "—"}
              />
              <Cell
                label="Laycan"
                value={
                  cl.is_spot
                    ? "SPOT"
                    : `${cl.laycan_from ?? "—"} to ${cl.laycan_to ?? "—"}`
                }
              />
            </Grid2>
          </InfoCard>

          {/* Specs */}
          <InfoCard title="Specifications">
            <Grid2>
              <Cell
                label="Qty min"
                value={`${(cl.qty_min_mt as number).toLocaleString()} MT`}
              />
              <Cell
                label="Qty max"
                value={`${(cl.qty_max_mt as number).toLocaleString()} MT`}
              />
              <Cell
                label="Stowage factor"
                value={cl.stowage_factor ? `${cl.stowage_factor} m³/t` : "—"}
              />
              <Cell
                label="Freight idea"
                value={
                  cl.freight_idea_usd_mt ? `$${cl.freight_idea_usd_mt}/MT` : "—"
                }
              />
              <Cell
                label="Load terms"
                value={(cl.load_terms as string) ?? "—"}
              />
              <Cell
                label="Commission"
                value={cl.commission_pct ? `${cl.commission_pct}%` : "—"}
              />
              <Cell label="Broker" value={(cl.broker as string) ?? "—"} />
              <Cell
                label="Goes live"
                value={fmt(cl.goes_live_at as string | null)}
              />
            </Grid2>
          </InfoCard>

          {/* Vessel requirements */}
          <InfoCard title="Vessel requirements">
            <Grid2>
              <Cell
                label="Requires geared"
                value={
                  typeof cl.requires_geared === "boolean"
                    ? cl.requires_geared
                      ? "Yes"
                      : "No"
                    : "—"
                }
              />
              <Cell
                label="Max age"
                value={
                  typeof cl.max_vessel_age_yr === "number"
                    ? `${cl.max_vessel_age_yr} years`
                    : "—"
                }
              />
              <Cell
                label="Max LOA"
                value={
                  typeof cl.max_loa_m === "number" ? `${cl.max_loa_m} m` : "—"
                }
              />
              <Cell
                label="Max draft"
                value={
                  typeof cl.max_draft_m === "number"
                    ? `${cl.max_draft_m} m`
                    : "—"
                }
              />
            </Grid2>
          </InfoCard>

          {/* Safety answers */}
          {(safetyAnswers ?? []).length > 0 && (
            <InfoCard title="Safety answers">
              <div className="space-y-1.5">
                {(safetyAnswers ?? []).map((a: Record<string, unknown>) => (
                  <div
                    key={a.question_key as string}
                    className="flex justify-between text-sm py-1 border-b border-asb-gray-100 last:border-0"
                  >
                    <span className="text-asb-gray-400 font-mono text-xs">
                      {a.question_key as string}
                    </span>
                    <span className="font-semibold text-asb-ink-soft">
                      {(a.answer_value as string) ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </InfoCard>
          )}

          {cl.notes && (
            <InfoCard title="Notes">
              <p className="text-sm text-asb-gray-700 leading-relaxed whitespace-pre-wrap">
                {cl.notes as string}
              </p>
            </InfoCard>
          )}

          {/* Queue history */}
          {queueHistory.length > 0 && (
            <InfoCard title="Review history">
              <div className="space-y-2">
                {queueHistory.map((rq) => (
                  <Link
                    key={rq.id}
                    href={`/admin/queue/${rq.id}`}
                    className="flex items-start justify-between gap-3 p-2.5 rounded hover:bg-asb-gray-50 transition-colors border border-transparent hover:border-asb-gray-200"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <ReviewStatusBadge status={rq.status} />
                        {rq.action_taken && (
                          <span className="text-[11px] text-asb-gray-400 capitalize">
                            {rq.action_taken}
                          </span>
                        )}
                      </div>
                      {rq.amendment_detail && (
                        <p className="text-xs text-asb-gray-500">
                          {rq.amendment_detail}
                        </p>
                      )}
                      <p className="text-[11px] text-asb-gray-400 mt-0.5">
                        {fmt(rq.reviewed_at ?? rq.created_at)}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-asb-gray-400 shrink-0 mt-0.5" />
                  </Link>
                ))}
              </div>
            </InfoCard>
          )}
        </div>

        {/* Right */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {/* Owner */}
          {owner && (
            <div className="bg-white border border-asb-gray-200 rounded p-5">
              <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
                Owner
              </p>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-asb-blue-light rounded-full flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-asb-blue" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-asb-ink">
                    {(owner.full_name as string) || "—"}
                  </p>
                  <p className="text-xs text-asb-gray-400">
                    {owner.email as string}
                  </p>
                  <Link
                    href={`/admin/users/${owner.id}`}
                    className="text-xs font-semibold text-asb-blue hover:text-asb-blue mt-1 inline-flex items-center gap-1"
                  >
                    View user <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </div>
          )}
          <CargoStatusControls
            cargoId={id}
            currentStatus={cl.status as string}
            currentReviewStatus={cl.review_status as string}
            pendingQueueItemId={pendingQueueItemId}
          />
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-asb-gray-200 rounded p-5">
      <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-4 pb-3 border-b border-asb-gray-100">
        {title}
      </p>
      {children}
    </div>
  );
}
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>;
}
function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-asb-gray-400 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p className="text-sm font-semibold text-asb-ink">{value}</p>
    </div>
  );
}
