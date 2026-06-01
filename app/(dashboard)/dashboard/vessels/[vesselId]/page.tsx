import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Anchor,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Minus,
  Calendar,
  MapPin,
  Clock,
  Ruler,
  Building2,
  DollarSign,
  ClipboardCheck,
  Lock,
} from "lucide-react";

import {
  VesselRow,
  VesselAvailabilityWithVessel,
  VesselContactRow,
} from "@/lib/schemas/vessel";
import { cn } from "@/lib/utils";
import { PostPositionButton } from "@/components/vessels/PostPositionButton";
import { UpgradeWall } from "@/components/vessels/UpgradeWall";
import { viewerTierFrom, isSubscriber } from "@/lib/tiers";

type Params = { vesselId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { vesselId } = await params;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data } = await supabase
    .from("vessels")
    .select("vessel_name")
    .eq("id", vesselId)
    .single();

  return { title: data ? `${data.vessel_name} — Arab ShipBroker` : "Vessel" };
}

export default async function VesselDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { vesselId } = await params;
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Read through the masked view: counterparty PII (owner/manager/
  // commercial-contact/PIC/website/charterer) resolves to NULL unless the
  // viewer is admin or this vessel's own claimant. Contact firewall lives
  // in the DB, not the UI.
  const { data: vessel, error } = await supabase
    .from("v_vessel_detail")
    .select("*")
    .eq("id", vesselId)
    .single();

  if (error || !vessel) notFound();
  const v = vessel as VesselRow;

  const { data: claim } = await supabase
    .from("vessel_claims")
    .select("id, role")
    .eq("vessel_id", vesselId)
    .maybeSingle();

  const isClaimed = !!claim;

  // Commercial/contact card is for the vessel's own owner or admin only.
  const { data: appUser } = await supabase
    .from("users")
    .select("role, subscription_tier, is_market_partner")
    .eq("supabase_user_id", user.id)
    .maybeSingle();
  const canSeeCommercial = isClaimed || appUser?.role === "admin";
  // Non-owner view: subscribers (T3/T4/partner) get the "brokered by ASB"
  // locked card; non-subscribers (T1/T2) get the upgrade teaser. Neither
  // reveals contact — that stays admin/owner-only.
  const viewerSubscriber = isSubscriber(viewerTierFrom(appUser));

  const { data: vesselContactsData } = await supabase
    .from("vessel_contacts")
    .select("id, vessel_id, name, role, email, phone, created_at, updated_at")
    .eq("vessel_id", vesselId)
    .order("created_at", { ascending: true });

  const vesselContacts = (vesselContactsData ?? []) as VesselContactRow[];

  const { data: availabilityData } = await supabase
    .from("vessel_availability")
    .select(
      "id, ref, status, review_status, open_port_name, open_port_locode, open_zone, open_date, open_date_range_days, freight_idea_usd_mt",
    )
    .eq("vessel_id", vesselId)
    .in("status", ["OPEN", "ON SUBS"])
    .order("open_date", { ascending: true })
    .limit(5);

  const availabilities = (availabilityData ?? []) as (Pick<
    VesselAvailabilityWithVessel,
    | "id"
    | "ref"
    | "status"
    | "review_status"
    | "open_port_locode"
    | "open_port_name"
    | "open_zone"
    | "open_date"
    | "open_date_range_days"
  > & { freight_idea_usd_mt: number | null })[];

  const currentYear = new Date().getFullYear();
  const vesselAge = v.build_year ? currentYear - v.build_year : null;

  function getDateUrgency(openDate: string | null) {
    if (!openDate) return { color: "", urgent: false };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const open = new Date(openDate);
    const diffDays = Math.ceil(
      (open.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays < 0)
      return { color: "text-red-600 bg-red-50 border-red-200", urgent: true };
    if (diffDays <= 7)
      return {
        color: "text-amber-700 bg-amber-50 border-amber-200",
        urgent: true,
      };
    return {
      color: "text-green-700 bg-green-50 border-green-200",
      urgent: false,
    };
  }

  return (
    <div className="py-2 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 max-[768px]:flex-col">
        <div className="flex items-start gap-4">
          <Link
            href="/dashboard/vessels"
            className="mt-1 p-2 rounded text-asb-gray-400 hover:text-asb-ink hover:bg-asb-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4.5 h-4.5" />
          </Link>
          <div>
            <h1 className="text-[17px] font-medium text-asb-navy">
              {v.vessel_name}
            </h1>
            <p className="text-xs text-asb-gray-500 mt-1">
              {v.vessel_type}
              {v.imo_number && ` · IMO ${v.imo_number}`}
              {v.flag && ` · ${v.flag}`}
              {v.build_year && (
                <>
                  {" · Built "}
                  {v.build_year}
                  {vesselAge !== null && (
                    <span className="text-asb-gray-400"> ({vesselAge} yrs)</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {isClaimed && (
          <PostPositionButton
            vesselId={vesselId}
            disabled={v.vessel_review_status === "IN_REVIEW"}
            title="This vessel is under review and cannot have new positions posted"
          />
        )}
      </div>

      {v.is_sanctioned && (
        <div className="bg-asb-red-bg border border-asb-red-bg rounded p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-asb-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-asb-red">Sanctioned vessel</p>
            <p className="text-xs text-asb-red mt-0.5 opacity-80">
              This vessel is on a sanctions list. No positions can be posted.
            </p>
          </div>
        </div>
      )}

      {v.risk_level === "HIGH" && (
        <div className="bg-asb-amber-bg border border-asb-amber-bg rounded p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-asb-amber shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-asb-amber">
              Positions require additional review
            </p>
            <p className="text-xs text-asb-amber mt-0.5 opacity-80">
              Arab ShipBroker will review each position posted for this vessel
              before it goes live.
            </p>
          </div>
        </div>
      )}

      {v.vessel_review_status === "IN_REVIEW" && (
        <div className="bg-asb-amber-bg border border-asb-amber-bg rounded p-4 flex gap-3">
          <ClipboardCheck className="w-4 h-4 text-asb-amber shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-asb-amber">
              This vessel is currently under Arab ShipBroker review
            </p>
            {v.vessel_review_reason && (
              <p className="text-xs text-asb-amber mt-1 leading-relaxed opacity-90">
                <span className="font-medium">Reason: </span>
                {v.vessel_review_reason}
              </p>
            )}
            <p className="text-[11px] text-asb-amber mt-2 opacity-70">
              You may continue to manage existing positions. Contact Arab
              ShipBroker if you have questions about this review.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 max-[1024px]:grid-cols-1 gap-6">
        <div className="col-span-2 max-[1024px]:col-span-1 space-y-4">
          <IntelCard title="Vessel Particulars" icon={Ruler}>
            <div className="grid grid-cols-4 max-[1024px]:grid-cols-2 gap-3">
              <StatBox
                label="DWT Grain"
                value={
                  v.dwt_grain ? `${v.dwt_grain.toLocaleString()} MT` : null
                }
              />
              <StatBox
                label="DWT Bale"
                value={v.dwt_bale ? `${v.dwt_bale.toLocaleString()} MT` : null}
              />
              <StatBox
                label="LOA"
                value={v.max_loa_m ? `${v.max_loa_m} m` : null}
              />
              <StatBox
                label="Draft — Summer"
                value={v.max_draft_m ? `${v.max_draft_m} m` : null}
              />
            </div>
          </IntelCard>

          <IntelCard title="Certifications & Equipment" icon={CheckCircle2}>
            <div className="grid grid-cols-3 max-[1024px]:grid-cols-2 max-[768px]:grid-cols-1 gap-3">
              <CapRow label="Geared" value={v.is_geared} />
              <CapRow label="Grain certified" value={v.grain_certified} />
              <CapRow label="DG certified" value={v.dg_certified} />
            </div>
            {v.is_geared && (v.crane_count || v.crane_swl_mt) && (
              <div className="mt-3 pt-3 border-t border-asb-gray-100 text-sm text-asb-gray-700">
                <span className="font-medium">Cranes: </span>
                {v.crane_count && `${v.crane_count}×`}
                {v.crane_swl_mt && ` ${v.crane_swl_mt} MT SWL`}
              </div>
            )}
          </IntelCard>

          {canSeeCommercial ? (
            <IntelCard title="Commercial Details" icon={Building2}>
              <div className="space-y-2.5 text-sm">
                {v.owner_company && (
                  <DetailRow
                    label="Owner"
                    value={`${v.owner_company}${v.owner_country ? `, ${v.owner_country}` : ""}`}
                  />
                )}
                {v.manager_company && (
                  <DetailRow
                    label="Technical manager"
                    value={`${v.manager_company}${v.manager_country ? `, ${v.manager_country}` : ""}`}
                  />
                )}
                {v.commercial_manager_company && (
                  <DetailRow
                    label="Commercial manager"
                    value={`${v.commercial_manager_company}${v.commercial_manager_country ? `, ${v.commercial_manager_country}` : ""}`}
                  />
                )}
                {v.commercial_manager_contact && (
                  <DetailRow
                    label="Commercial contact"
                    value={v.commercial_manager_contact}
                  />
                )}
                {v.commercial_manager_email && (
                  <DetailRow
                    label="Commercial email"
                    value={v.commercial_manager_email}
                  />
                )}
                {v.commercial_manager_phone && (
                  <DetailRow
                    label="Commercial phone"
                    value={v.commercial_manager_phone}
                  />
                )}
                {v.charter_status && (
                  <DetailRow label="Charter status" value={v.charter_status} />
                )}
                {v.tc_charterer_name && (
                  <DetailRow
                    label="TC charterer"
                    value={`${v.tc_charterer_name}${v.tc_expiry ? ` (exp. ${v.tc_expiry})` : ""}`}
                  />
                )}
                {v.bbc_charterer_name && (
                  <DetailRow
                    label="BBC charterer"
                    value={`${v.bbc_charterer_name}${v.bbc_expiry ? ` (exp. ${v.bbc_expiry})` : ""}`}
                  />
                )}
                {v.pi_club && <DetailRow label="P&I Club" value={v.pi_club} />}
                {(v.pi_ig_member === true || v.pi_ig_member === false) && (
                  <DetailRow
                    label="P&I IG member"
                    value={v.pi_ig_member ? "Yes" : "No"}
                  />
                )}
                {v.pi_coverage_types && v.pi_coverage_types.length > 0 && (
                  <DetailRow
                    label="P&I coverage"
                    value={v.pi_coverage_types.join(", ")}
                  />
                )}
                {v.war_risk_trading && (
                  <DetailRow
                    label="War risk trading"
                    value={v.war_risk_trading}
                  />
                )}
                {v.war_risk_conditions && (
                  <DetailRow
                    label="War risk conditions"
                    value={v.war_risk_conditions}
                  />
                )}
                {v.preferred_trading_areas &&
                  v.preferred_trading_areas.length > 0 && (
                    <DetailRow
                      label="Preferred trading areas"
                      value={v.preferred_trading_areas.join(", ")}
                    />
                  )}
              </div>
            </IntelCard>
          ) : viewerSubscriber ? (
            <MaskedCommercialCard />
          ) : (
            <UpgradeWall
              vesselName={v.vessel_name}
              vesselType={v.vessel_type}
              builtYear={v.build_year}
            />
          )}

          {vesselContacts.length > 0 && (
            <IntelCard title="Persons in Charge" icon={Building2}>
              <div className="space-y-3">
                {vesselContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="rounded border border-asb-gray-100 bg-asb-gray-50 px-3 py-2.5"
                  >
                    <p className="text-sm font-semibold text-asb-ink">
                      {contact.name}
                    </p>
                    <p className="text-xs text-asb-gray-500 mt-0.5">
                      {contact.role}
                    </p>
                    {(contact.email || contact.phone) && (
                      <p className="text-xs text-asb-gray-500 mt-1.5">
                        {contact.email ?? ""}
                        {contact.email && contact.phone ? " · " : ""}
                        {contact.phone ?? ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </IntelCard>
          )}

          {v.notes && (
            <IntelCard title="Notes" icon={Anchor}>
              <p className="text-sm text-asb-gray-700 leading-relaxed">
                {v.notes}
              </p>
            </IntelCard>
          )}
        </div>

        <div className="space-y-4">
          <IntelCard title="Open Positions" icon={Anchor}>
            {availabilities.length === 0 ? (
              <div className="text-center py-8">
                <Anchor className="w-7 h-7 text-asb-gray-400 mx-auto mb-2" />
                <p className="text-sm text-asb-gray-500 font-medium">
                  No open positions
                </p>
                {isClaimed && (
                  <Link
                    href={`/dashboard/vessels/${vesselId}/availability/new`}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-asb-blue hover:text-asb-blue font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" /> Post new position
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {availabilities.map((a) => {
                  const urgency = getDateUrgency(a.open_date);
                  return (
                    <div
                      key={a.id}
                      className="block p-3.5 rounded border border-asb-gray-200 hover:border-asb-blue hover:bg-asb-blue-light/40 transition-all"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Link
                          href={`/dashboard/vessels/${vesselId}/availability/${a.id}`}
                          className="text-xs font-mono text-asb-gray-400 hover:text-asb-blue"
                        >
                          {a.ref ?? "—"}
                        </Link>
                        <PositionStatusPill
                          status={a.status}
                          reviewStatus={a.review_status}
                        />
                      </div>

                      {a.open_port_name && (
                        <div className="flex items-center gap-1.5 text-xs text-asb-gray-700 mb-1">
                          <MapPin className="w-3 h-3 text-asb-gray-400 shrink-0" />
                          <span>
                            {a.open_port_locode ? (
                              <Link
                                href={`/dashboard/ports/${a.open_port_locode}`}
                                className="font-semibold text-asb-ink-soft hover:text-asb-blue hover:underline"
                              >
                                {a.open_port_name}
                              </Link>
                            ) : (
                              a.open_port_name
                            )}
                            {a.open_zone && (
                              <span className="text-asb-gray-400 ml-1">
                                ({a.open_zone})
                              </span>
                            )}
                          </span>
                        </div>
                      )}

                      {a.open_date && (
                        <div className="flex items-center gap-1.5 text-xs mb-1">
                          <Calendar className="w-3 h-3 text-asb-gray-400 shrink-0" />
                          <span
                            className={cn(
                              "font-medium",
                              urgency.color
                                ? urgency.color.split(" ")[0]
                                : "text-asb-gray-500",
                            )}
                          >
                            {a.open_date}
                          </span>
                          {a.open_date_range_days > 0 && (
                            <span className="text-asb-gray-400">
                              ±{a.open_date_range_days}d
                            </span>
                          )}
                          {urgency.urgent && (
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          )}
                        </div>
                      )}

                      {a.freight_idea_usd_mt && (
                        <div className="flex items-center gap-1.5 text-xs text-asb-gray-500">
                          <DollarSign className="w-3 h-3 text-asb-gray-400 shrink-0" />
                          <span>${a.freight_idea_usd_mt}/MT</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {isClaimed && (
                  <Link
                    href={`/dashboard/vessels/${vesselId}/availability/new`}
                    className="mt-1 flex items-center justify-center gap-1.5 w-full py-2 rounded border border-dashed border-asb-blue text-xs font-semibold text-asb-blue hover:bg-asb-blue-light transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Post new position
                  </Link>
                )}
              </div>
            )}
          </IntelCard>

          <div
            className={cn(
              "rounded border p-4 text-sm",
              isClaimed
                ? "bg-green-50 border-green-200"
                : "bg-asb-gray-50 border-asb-gray-200",
            )}
          >
            <div className="flex items-center gap-2 font-semibold mb-1">
              {isClaimed ? (
                <>
                  <Shield className="w-4 h-4 text-green-600" />{" "}
                  <span className="text-green-800">Your vessel</span>
                </>
              ) : (
                <>
                  <Anchor className="w-4 h-4 text-asb-gray-400" />{" "}
                  <span className="text-asb-gray-700">Not your vessel</span>
                </>
              )}
            </div>
            <p className="text-xs text-asb-gray-500">
              {isClaimed
                ? `You registered this vessel (${claim?.role ?? "owner"}). You can post positions from this page.`
                : "This vessel was added by Arab ShipBroker or another operator. Contact us to claim it."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntelCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-asb-white rounded border border-asb-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3 pb-2.5 border-b border-asb-gray-100">
        <Icon className="w-3.5 h-3.5 text-asb-gray-400" />
        <h3 className="text-[10px] font-medium text-asb-gray-500 uppercase tracking-[0.09em]">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

// Firewall made visible: non-owner / non-admin viewers get a locked identity
// card instead of a silently-absent one. Renders NO identity — only the gating
// message — matching the design's "available to Tier 3 & Partner" treatment.
function MaskedCommercialCard() {
  return (
    <IntelCard title="Company & Contacts" icon={Lock}>
      <div className="flex flex-col items-center px-2 py-4 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-asb-gray-200 bg-asb-gray-100">
          <Lock className="h-4 w-4 text-asb-gray-400" />
        </div>
        <p className="text-sm font-semibold text-asb-ink-soft">
          Identity available to Tier 3 &amp; Partner
        </p>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-asb-gray-500">
          Owner, company roles and contacts for this vessel are shown only to
          authorised subscribers. Arab ShipBroker holds these details and sits
          in the middle.
        </p>
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-asb-gray-400">
          <Lock className="h-3 w-3" /> Encrypted at rest
        </div>
      </div>
    </IntelCard>
  );
}

function StatBox({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-asb-gray-50 rounded-[3px] px-3 py-2.5 border border-asb-gray-100">
      <p className="text-[8px] text-asb-gray-500 font-medium uppercase tracking-[0.06em] mb-0.5">
        {label}
      </p>
      <p className="text-sm font-semibold text-asb-navy tabular-nums">
        {value ?? "—"}
      </p>
    </div>
  );
}

function CapRow({ label, value }: { label: string; value: boolean | null }) {
  const Icon =
    value === true ? CheckCircle2 : value === false ? XCircle : Minus;
  const color =
    value === true
      ? "text-asb-green"
      : value === false
        ? "text-asb-gray-400"
        : "text-asb-gray-400";

  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
      <span
        className={cn(
          "font-medium",
          value === null ? "text-asb-gray-400" : "text-asb-ink",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <span className="text-[10px] uppercase tracking-wide text-asb-gray-500 font-medium shrink-0">
        {label}
      </span>
      <span className="text-xs text-asb-ink font-medium text-right tabular-nums max-w-[65%]">
        {value}
      </span>
    </div>
  );
}

function PositionStatusPill({
  status,
  reviewStatus,
}: {
  status: string;
  reviewStatus: string;
}) {
  if (reviewStatus === "PENDING") {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
        <Clock className="w-3 h-3" /> Under review
      </span>
    );
  }
  const isOpen = status === "OPEN";
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide",
        isOpen
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-amber-50 text-amber-700 border-amber-200",
      )}
    >
      {status}
    </span>
  );
}
