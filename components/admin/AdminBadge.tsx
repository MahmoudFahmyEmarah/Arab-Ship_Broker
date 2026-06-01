import { cn } from "@/lib/utils";

type BadgeVariant =
  | "pending"
  | "approved"
  | "rejected"
  | "flagged"
  | "new"
  | "verified"
  | "high"
  | "medium"
  | "low"
  | "clear"
  | "sanctioned"
  | "active"
  | "inactive"
  | "open"
  | "fixed"
  | "subs"
  | "neutral";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  pending: "bg-amber-50   text-amber-700  border-amber-200",
  approved: "bg-green-50   text-green-700  border-green-200",
  rejected: "bg-red-50     text-red-700    border-red-200",
  flagged: "bg-red-50     text-red-700    border-red-200",
  new: "bg-slate-100  text-slate-600  border-slate-200",
  verified: "bg-green-50   text-green-700  border-green-200",
  high: "bg-red-50     text-red-700    border-red-200",
  medium: "bg-amber-50   text-amber-700  border-amber-200",
  low: "bg-blue-50    text-blue-700   border-blue-200",
  clear: "bg-green-50   text-green-700  border-green-200",
  sanctioned: "bg-red-100    text-red-800    border-red-300",
  active: "bg-green-50   text-green-700  border-green-200",
  inactive: "bg-slate-100  text-slate-500  border-slate-200",
  open: "bg-green-50   text-green-700  border-green-200",
  fixed: "bg-slate-100  text-slate-600  border-slate-200",
  subs: "bg-amber-50   text-amber-700  border-amber-200",
  neutral: "bg-slate-50   text-slate-600  border-slate-200",
};

interface AdminBadgeProps {
  variant: BadgeVariant;
  label: string;
  className?: string;
}

export function AdminBadge({ variant, label, className }: AdminBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {label}
    </span>
  );
}

// ─── Convenience helpers used across admin tables ──────────────

export function ReviewStatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
    FLAGGED: "flagged",
  };
  return (
    <AdminBadge variant={variantMap[status] ?? "neutral"} label={status} />
  );
}

export function TrustTierBadge({ tier }: { tier: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    NEW: "new",
    VERIFIED: "verified",
    FLAGGED: "flagged",
  };
  return <AdminBadge variant={variantMap[tier] ?? "neutral"} label={tier} />;
}

export function RiskLevelBadge({ level }: { level: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    CLEAR: "clear",
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
  };
  return <AdminBadge variant={variantMap[level] ?? "neutral"} label={level} />;
}

export function VesselStatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    OPEN: "open",
    FIXED: "fixed",
    "ON SUBS": "subs",
    INACTIVE: "inactive",
  };
  return (
    <AdminBadge variant={variantMap[status] ?? "neutral"} label={status} />
  );
}
