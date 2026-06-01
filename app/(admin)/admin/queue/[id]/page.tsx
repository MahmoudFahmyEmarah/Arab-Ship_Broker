import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Package,
  Ship,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  User,
  Anchor,
  MapPin,
  Calendar,
  Scale,
  DollarSign,
  ExternalLink,
  Info,
} from "lucide-react";
import {
  requireAdmin,
  getAdminSupabaseClient,
} from "@/lib/admin/require-admin";
import {
  ReviewStatusBadge,
  TrustTierBadge,
} from "@/components/admin/AdminBadge";
import { ReviewActions } from "@/components/admin/queue/ReviewActions";
import type { QueueItem } from "@/lib/admin/types";
import { cn } from "@/lib/utils";


function s(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function n(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function b(value: unknown): boolean {
  return value === true || value === "true";
}


function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(iso: string): string {
  const minutes = getAgeMinutes(iso);
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getAgeMinutes(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}


function DetailCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-asb-gray-200 rounded p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-asb-gray-100">
        <Icon className="w-4 h-4 text-asb-gray-400" />
        <h3 className="text-xs font-bold text-asb-gray-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 max-[768px]:grid-cols-1 gap-3">
      {children}
    </div>
  );
}

function DetailCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-asb-gray-400 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold",
          highlight ? "text-red-600" : "text-asb-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}


export default async function QueueItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await getAdminSupabaseClient();

  const { data, error } = await supabase
    .from("v_admin_queue_detail")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) notFound();
  const item = data as QueueItem;

  const isCargo = item.listing_type === "cargo";
  const isPending = item.status === "PENDING";
  const age = formatAge(item.created_at);
  const slaBreached = isPending && getAgeMinutes(item.created_at) > 120;

  let cargoFull: Record<string, unknown> | null = null;
  let vesselFull: Record<string, unknown> | null = null;
  let safetyAnswers: { question_key: string; answer_value: string | null }[] =
    [];

  if (isCargo && item.listing_id) {
    const { data: cl } = await supabase
      .from("cargo_listings")
      .select("*")
      .eq("id", item.listing_id)
      .single();
    cargoFull = cl;
    const { data: sa } = await supabase
      .from("cargo_safety_answers")
      .select("question_key, answer_value")
      .eq("cargo_listing_id", item.listing_id);
    safetyAnswers = sa ?? [];
  } else if (!isCargo && item.listing_id) {
    const { data: va } = await supabase
      .from("vessel_availability")
      .select(`*, vessel:vessels(*)`)
      .eq("id", item.listing_id)
      .single();
    vesselFull = va;
  }

  return (
    <div className="space-y-6 max-w-5xl py-2">
      <Link
        href="/admin/queue"
        className="inline-flex items-center gap-1.5 text-sm text-asb-gray-500 hover:text-asb-ink transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to review queue
      </Link>

      <div
        className={cn(
          "bg-white border rounded p-5 shadow-sm",
          slaBreached ? "border-red-300" : "border-asb-gray-200",
        )}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded flex items-center justify-center shrink-0",
                isCargo
                  ? "bg-asb-blue-light border border-asb-gray-200"
                  : "bg-foam-50 border border-foam-100",
              )}
            >
              {isCargo ? (
                <Package className="w-5 h-5 text-asb-blue" />
              ) : (
                <Ship className="w-5 h-5 text-foam-600" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider">
                {isCargo ? "Cargo listing" : "Vessel availability"} — Queue item
              </p>
              <h1 className="text-lg font-bold text-asb-navy mt-0.5">
                {item.cargo_ref ?? item.vessel_name ?? item.listing_id}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ReviewStatusBadge status={item.status} />
            {item.submitter_trust_tier && (
              <TrustTierBadge tier={item.submitter_trust_tier} />
            )}
            {slaBreached && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
                <AlertTriangle className="w-3 h-3" /> SLA BREACHED — {age}
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-asb-gray-100 grid grid-cols-3 max-[768px]:grid-cols-1 gap-4 text-xs text-asb-gray-500">
          <div>
            <span className="font-semibold text-asb-gray-400 uppercase tracking-wider text-[10px]">
              Submitted
            </span>
            <p className="font-semibold text-asb-ink-soft mt-0.5">
              {formatDate(item.created_at)} ({age} ago)
            </p>
          </div>
          <div>
            <span className="font-semibold text-asb-gray-400 uppercase tracking-wider text-[10px]">
              Review reason
            </span>
            <p className="font-semibold text-asb-ink-soft mt-0.5">
              {item.review_reason ?? "—"}
            </p>
          </div>
          <div>
            <span className="font-semibold text-asb-gray-400 uppercase tracking-wider text-[10px]">
              Random sample
            </span>
            <p className="font-semibold text-asb-ink-soft mt-0.5">
              {item.is_random_sample ? "Yes" : "No"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_320px] max-[1024px]:grid-cols-1 gap-6 items-start">
        <div className="space-y-4">
          {isCargo && cargoFull && (
            <div className="space-y-4">
              <DetailCard title="Route" icon={MapPin}>
                <DetailGrid>
                  <DetailCell
                    label="Load port"
                    value={
                      cargoFull.load_port_name && cargoFull.load_port_locode ? (
                        <span>
                          <Link
                            href={`/dashboard/ports/${s(cargoFull.load_port_locode)}`}
                            className="hover:text-asb-blue hover:underline"
                          >
                            {s(cargoFull.load_port_name)}
                          </Link>
                          <span className="text-asb-gray-400">{` (${s(cargoFull.load_port_locode)})`}</span>
                        </span>
                      ) : (
                        `${s(cargoFull.load_port_name)} (${s(cargoFull.load_port_locode)})`
                      )
                    }
                  />
                  <DetailCell
                    label="Load zone"
                    value={s(cargoFull.load_zone)}
                  />
                  <DetailCell
                    label="Load country"
                    value={s(cargoFull.load_country)}
                  />
                  <DetailCell
                    label="Discharge port"
                    value={
                      cargoFull.disch_port_name &&
                      cargoFull.disch_port_locode ? (
                        <span>
                          <Link
                            href={`/dashboard/ports/${s(cargoFull.disch_port_locode)}`}
                            className="hover:text-asb-blue hover:underline"
                          >
                            {s(cargoFull.disch_port_name)}
                          </Link>
                          <span className="text-asb-gray-400">{` (${s(cargoFull.disch_port_locode)})`}</span>
                        </span>
                      ) : (
                        `${s(cargoFull.disch_port_name)} (${s(cargoFull.disch_port_locode)})`
                      )
                    }
                  />
                  <DetailCell
                    label="Discharge zone"
                    value={s(cargoFull.disch_zone)}
                  />
                  <DetailCell
                    label="Discharge country"
                    value={s(cargoFull.disch_country)}
                  />
                </DetailGrid>
              </DetailCard>

              <DetailCard title="Cargo specifications" icon={Scale}>
                <DetailGrid>
                  <DetailCell
                    label="Commodity"
                    value={s(cargoFull.commodity_name)}
                  />
                  <DetailCell label="Type" value={s(cargoFull.cargo_type)} />
                  <DetailCell
                    label="Qty min"
                    value={
                      n(cargoFull.qty_min_mt) !== null
                        ? `${n(cargoFull.qty_min_mt)!.toLocaleString()} MT`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Qty max"
                    value={
                      n(cargoFull.qty_max_mt) !== null
                        ? `${n(cargoFull.qty_max_mt)!.toLocaleString()} MT`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Stowage factor"
                    value={
                      cargoFull.stowage_factor
                        ? `${s(cargoFull.stowage_factor)} ft³/LT`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="DG cargo"
                    value={b(cargoFull.is_dg_cargo) ? "Yes ⚠️" : "No"}
                    highlight={b(cargoFull.is_dg_cargo)}
                  />
                  <DetailCell
                    label="Grain cargo"
                    value={b(cargoFull.is_grain_cargo) ? "Yes" : "No"}
                  />
                </DetailGrid>
              </DetailCard>

              <DetailCard title="Laycan" icon={Calendar}>
                <DetailGrid>
                  <DetailCell
                    label="Laycan from"
                    value={s(cargoFull.laycan_from, "SPOT")}
                  />
                  <DetailCell
                    label="Laycan to"
                    value={s(cargoFull.laycan_to, "SPOT")}
                  />
                  <DetailCell
                    label="SPOT"
                    value={b(cargoFull.is_spot) ? "Yes" : "No"}
                  />
                </DetailGrid>
              </DetailCard>

              <DetailCard title="Commercial terms" icon={DollarSign}>
                <DetailGrid>
                  <DetailCell
                    label="Freight idea"
                    value={
                      cargoFull.freight_idea_usd_mt
                        ? `$${s(cargoFull.freight_idea_usd_mt)}/MT`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Load terms"
                    value={s(cargoFull.load_terms)}
                  />
                  <DetailCell
                    label="Load rate"
                    value={
                      cargoFull.load_rate
                        ? `${s(cargoFull.load_rate)} MT/day`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Disch rate"
                    value={
                      cargoFull.disch_rate
                        ? `${s(cargoFull.disch_rate)} MT/day`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Commission"
                    value={
                      cargoFull.commission_pct
                        ? `${s(cargoFull.commission_pct)}%`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Commission TTL"
                    value={
                      cargoFull.commission_ttl_pct
                        ? `${s(cargoFull.commission_ttl_pct)}%`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Demurrage"
                    value={
                      cargoFull.demurrage_rate
                        ? `$${s(cargoFull.demurrage_rate)}/day`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Despatch"
                    value={
                      cargoFull.despatch_rate
                        ? `$${s(cargoFull.despatch_rate)}/day`
                        : "—"
                    }
                  />
                </DetailGrid>
              </DetailCard>

              <DetailCard title="Vessel requirements" icon={Ship}>
                <DetailGrid>
                  <DetailCell
                    label="Requires geared"
                    value={
                      cargoFull.requires_geared === true
                        ? "Yes"
                        : cargoFull.requires_geared === false
                          ? "No"
                          : "—"
                    }
                    highlight={b(cargoFull.requires_geared)}
                  />
                  <DetailCell
                    label="Max vessel age"
                    value={
                      cargoFull.max_vessel_age_yr
                        ? `${s(cargoFull.max_vessel_age_yr)} years`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Max LOA"
                    value={
                      cargoFull.max_loa_m ? `${s(cargoFull.max_loa_m)} m` : "—"
                    }
                  />
                  <DetailCell
                    label="Max draft"
                    value={
                      cargoFull.max_draft_m
                        ? `${s(cargoFull.max_draft_m)} m`
                        : "—"
                    }
                  />
                </DetailGrid>
              </DetailCard>

              {safetyAnswers.length > 0 && (
                <DetailCard title="Safety question answers" icon={Info}>
                  <div className="space-y-2">
                    {safetyAnswers.map((a) => (
                      <div
                        key={a.question_key}
                        className="flex justify-between items-center text-sm py-1 border-b border-asb-gray-100 last:border-0"
                      >
                        <span className="text-asb-gray-500 font-mono text-xs">
                          {a.question_key}
                        </span>
                        <span className="font-semibold text-asb-ink">
                          {a.answer_value ?? "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </DetailCard>
              )}

              {Boolean(cargoFull.notes) && (
                <DetailCard title="Broker notes" icon={Info}>
                  <p className="text-sm text-asb-gray-700 leading-relaxed whitespace-pre-wrap">
                    {s(cargoFull.notes)}
                  </p>
                </DetailCard>
              )}

              <div className="flex justify-end">
                <Link
                  href={`/admin/cargo/${item.listing_id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-asb-blue hover:text-asb-blue"
                >
                  Open full cargo record{" "}
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}

          {!isCargo && vesselFull && (
            <div className="space-y-4">
              {Boolean(vesselFull.vessel) &&
                (() => {
                  const v = vesselFull.vessel as Record<string, unknown>;
                  return (
                    <DetailCard title="Vessel intelligence" icon={Ship}>
                      <DetailGrid>
                        <DetailCell
                          label="Vessel name"
                          value={s(v.vessel_name)}
                        />
                        <DetailCell label="IMO" value={s(v.imo_number)} />
                        <DetailCell label="Type" value={s(v.vessel_type)} />
                        <DetailCell
                          label="DWT grain"
                          value={
                            n(v.dwt_grain) !== null
                              ? `${n(v.dwt_grain)!.toLocaleString()} MT`
                              : "—"
                          }
                        />
                        <DetailCell
                          label="Build year"
                          value={s(v.build_year)}
                        />
                        <DetailCell label="Flag" value={s(v.flag)} />
                        <DetailCell
                          label="Geared"
                          value={b(v.is_geared) ? "Yes" : "No"}
                        />
                        <DetailCell
                          label="Grain cert"
                          value={b(v.grain_certified) ? "Yes" : "No"}
                        />
                        <DetailCell
                          label="DG cert"
                          value={b(v.dg_certified) ? "Yes" : "No"}
                        />
                        <DetailCell
                          label="Risk level"
                          value={s(v.risk_level)}
                          highlight={v.risk_level === "HIGH"}
                        />
                        <DetailCell label="Scope" value={s(v.scope)} />
                        <DetailCell
                          label="Sanctioned"
                          value={b(v.is_sanctioned) ? "YES ⛔" : "No"}
                          highlight={b(v.is_sanctioned)}
                        />
                      </DetailGrid>
                      <div className="mt-3 flex justify-end">
                        <Link
                          href={`/admin/vessels/${s(v.id)}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-asb-blue hover:text-asb-blue"
                        >
                          Open vessel record{" "}
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </DetailCard>
                  );
                })()}

              <DetailCard title="Availability posting" icon={Anchor}>
                <DetailGrid>
                  <DetailCell
                    label="Open port"
                    value={
                      vesselFull.open_port_name &&
                      vesselFull.open_port_locode ? (
                        <span>
                          <Link
                            href={`/dashboard/ports/${s(vesselFull.open_port_locode)}`}
                            className="hover:text-asb-blue hover:underline"
                          >
                            {s(vesselFull.open_port_name)}
                          </Link>
                          <span className="text-asb-gray-400">{` (${s(vesselFull.open_port_locode)})`}</span>
                        </span>
                      ) : (
                        `${s(vesselFull.open_port_name)} (${s(vesselFull.open_port_locode)})`
                      )
                    }
                  />
                  <DetailCell
                    label="Open zone"
                    value={s(vesselFull.open_zone)}
                  />
                  <DetailCell
                    label="Open date"
                    value={s(vesselFull.open_date)}
                  />
                  <DetailCell
                    label="Flexibility"
                    value={
                      vesselFull.open_date_range_days
                        ? `±${s(vesselFull.open_date_range_days)} days`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Last cargo"
                    value={s(vesselFull.last_cargo)}
                  />
                  <DetailCell
                    label="Part cargo"
                    value={
                      b(vesselFull.accepts_part_cargo)
                        ? "Yes (±20% DWT)"
                        : "No (±10% DWT)"
                    }
                  />
                  <DetailCell
                    label="Freight idea"
                    value={
                      vesselFull.freight_idea_usd_mt
                        ? `$${s(vesselFull.freight_idea_usd_mt)}/MT`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="Speed"
                    value={
                      vesselFull.service_speed_kn
                        ? `${s(vesselFull.service_speed_kn)} kn`
                        : "—"
                    }
                  />
                  <DetailCell
                    label="ME consumption"
                    value={
                      vesselFull.me_consumption_mt_day
                        ? `${s(vesselFull.me_consumption_mt_day)} MT/day`
                        : "—"
                    }
                  />
                </DetailGrid>
              </DetailCard>

              {Boolean(vesselFull.notes) && (
                <DetailCard title="Notes" icon={Info}>
                  <p className="text-sm text-asb-gray-700 leading-relaxed">
                    {s(vesselFull.notes)}
                  </p>
                </DetailCard>
              )}

              <div className="flex justify-end">
                <Link
                  href={`/admin/vessel-availability/${item.listing_id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-asb-blue hover:text-asb-blue"
                >
                  Open full availability record{" "}
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="bg-white border border-asb-gray-200 rounded p-5">
            <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-3">
              Submitter
            </h2>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 bg-asb-blue-light rounded-full flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-asb-blue" />
              </div>
              <div>
                <p className="text-sm font-bold text-asb-navy">
                  {item.submitter_name ?? "—"}
                </p>
                <p className="text-xs text-asb-gray-400">
                  {item.submitter_email ?? "—"}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-asb-gray-400">Trust tier</span>
                {item.submitter_trust_tier && (
                  <TrustTierBadge tier={item.submitter_trust_tier} />
                )}
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-asb-gray-400">Clean posts</span>
                <span className="font-semibold text-asb-ink-soft">
                  {item.submitter_clean_posts ?? 0}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-asb-gray-400">Strike count</span>
                <span
                  className={cn(
                    "font-semibold",
                    (item.submitter_strike_count ?? 0) > 0
                      ? "text-red-600"
                      : "text-asb-ink-soft",
                  )}
                >
                  {item.submitter_strike_count ?? 0}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-asb-gray-100">
              <Link
                href={`/admin/users?q=${encodeURIComponent(item.submitter_email ?? "")}`}
                className="text-xs font-semibold text-asb-blue hover:text-asb-blue flex items-center gap-1"
              >
                View user profile <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          </div>

          <div className="bg-asb-gray-50 border border-asb-gray-200 rounded p-4">
            <h2 className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-2">
              Action effects
            </h2>
            <div className="space-y-2 text-xs text-asb-gray-500">
              <p>
                <span className="font-semibold text-green-700">Approve</span> —
                Listing goes live · clean_posts +1 · trust auto-upgrade at 5
              </p>
              <p>
                <span className="font-semibold text-amber-700">Amend</span> —
                Listing goes live with corrections · strike_count +1
              </p>
              <p>
                <span className="font-semibold text-red-700">Reject</span> —
                Listing never goes live · strike_count +1
              </p>
              <p>
                <span className="font-semibold text-orange-700">Flag</span> —
                Listing held · strike_count +1 · account reviewed
              </p>
              <p className="text-asb-gray-400 pt-1 border-t border-asb-gray-200 mt-1">
                At 2 strikes: account auto-downgrades to FLAGGED tier
              </p>
            </div>
          </div>

          {isPending ? (
            <ReviewActions
              queueItemId={item.id}
              listingType={item.listing_type}
            />
          ) : (
            <div className="bg-white border border-asb-gray-200 rounded p-5 text-center">
              {item.status === "APPROVED" ? (
                <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              )}
              <p className="text-sm font-bold text-asb-ink-soft capitalize">
                {item.status.toLowerCase()}
              </p>
              {item.reviewed_at && (
                <p className="text-xs text-asb-gray-400 mt-1">
                  {formatDate(item.reviewed_at)}
                </p>
              )}
              {item.amendment_detail && (
                <p className="text-xs text-asb-gray-500 mt-2 bg-asb-gray-50 rounded-lg p-2 text-left">
                  {item.amendment_detail}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
