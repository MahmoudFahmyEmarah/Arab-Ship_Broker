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

// Map each semantic variant onto an adm-badge palette class (admin.css). One
// dense, navy/amber badge language across the whole console.
const VARIANT_CLASS: Record<BadgeVariant, string> = {
  pending: "pending",
  approved: "live",
  rejected: "rejected",
  flagged: "flagged",
  new: "draft",
  verified: "live",
  high: "rejected",
  medium: "amber",
  low: "closed",
  clear: "live",
  sanctioned: "flagged",
  active: "active",
  inactive: "inactive",
  open: "live",
  fixed: "draft",
  subs: "amber",
  neutral: "draft",
};

interface AdminBadgeProps {
  variant: BadgeVariant;
  label: string;
  className?: string;
}

export function AdminBadge({ variant, label, className }: AdminBadgeProps) {
  return (
    <span className={cn("adm-badge", VARIANT_CLASS[variant], className)}>
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
