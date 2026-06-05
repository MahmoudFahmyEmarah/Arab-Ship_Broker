"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LogOut,
  Package,
  Clock,
  User,
  X,
  Search,
  LayoutDashboard,
  AlertTriangle,
  CheckCircle2,
  Ship,
  Loader2,
  Plus,
  Sparkles,
  Calculator,
  Anchor,
  Waves,
} from "lucide-react";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logout } from "@/sdk/auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/contexts/DashboardContext";

interface DashboardSidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

type NavLink = {
  label: string;
  href: string;
  icon: React.ElementType;
  disabled?: boolean;
  tooltip?: string;
};

type NavSection = {
  label: string;
  links: NavLink[];
};

// Light-terminal trust-tier chip styling (design tokens).
const TRUST_TIER_CONFIG = {
  NEW: {
    label: "New Account",
    icon: Clock,
    text: "text-asb-amber",
    bg: "bg-asb-amber-bg",
    dot: "bg-asb-amber",
    hint: "Posts held for review",
  },
  VERIFIED: {
    label: "Verified",
    icon: CheckCircle2,
    text: "text-asb-green",
    bg: "bg-asb-green-bg",
    dot: "bg-asb-green",
    hint: "Posts go live instantly",
  },
  FLAGGED: {
    label: "Flagged",
    icon: AlertTriangle,
    text: "text-asb-red",
    bg: "bg-asb-red-bg",
    dot: "bg-asb-red",
    hint: "Contact support",
  },
} as const;

function buildNavSections(
  hasCargoProfile: boolean,
  hasVesselProfile: boolean,
): NavSection[] {
  const sections: NavSection[] = [];

  sections.push({
    label: "Overview",
    links: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  });

  const workspaceLinks: NavLink[] = [
    { label: "Circular Parser", href: "/dashboard/circulars", icon: Sparkles },
  ];
  if (hasCargoProfile) {
    workspaceLinks.push(
      { label: "My Listings", href: "/dashboard/cargo/my", icon: Package },
      { label: "Post Cargo", href: "/dashboard/cargo/create", icon: Plus },
    );
  }
  if (hasVesselProfile) {
    workspaceLinks.push({
      label: "My Vessels",
      href: "/dashboard/vessels",
      icon: Ship,
    });
  }
  sections.push({ label: "Workspace", links: workspaceLinks });

  const discoverLinks: NavLink[] = [];
  if (hasCargoProfile || hasVesselProfile) {
    discoverLinks.push({
      label: hasCargoProfile ? "Cargo Market" : "Browse Cargo",
      href: "/dashboard/cargo",
      icon: hasCargoProfile ? Search : Package,
    });
    discoverLinks.push({
      label: "Tonnage Market",
      href: "/dashboard/vessels/browse",
      icon: Search,
    });
  }
  if (discoverLinks.length > 0) {
    sections.push({ label: "Discover", links: discoverLinks });
  }

  sections.push({
    label: "Economic Calculators",
    links: [
      {
        label: "Voyage Estimator",
        href: "/dashboard/voyage-estimator",
        icon: Calculator,
      },
      {
        label: "Ports DA Calculator",
        href: "#",
        icon: Anchor,
        disabled: true,
        tooltip: "Ports DA Calculator · Coming soon",
      },
      {
        label: "Suez Canal Toll",
        href: "#",
        icon: Waves,
        disabled: true,
        tooltip: "Suez Canal Toll · Coming soon",
      },
    ],
  });

  sections.push({
    label: "Account",
    links: [{ label: "Settings", href: "/dashboard/account", icon: User }],
  });

  return sections;
}

function isNavLinkActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/cargo") {
    return (
      pathname === "/dashboard/cargo" ||
      (pathname.startsWith("/dashboard/cargo/") &&
        !pathname.startsWith("/dashboard/cargo/my") &&
        !pathname.startsWith("/dashboard/cargo/create"))
    );
  }
  if (href === "/dashboard/cargo/my") {
    return (
      pathname === "/dashboard/cargo/my" ||
      pathname.startsWith("/dashboard/cargo/my/")
    );
  }
  if (href === "/dashboard/vessels/browse") {
    return (
      pathname === "/dashboard/vessels/browse" ||
      pathname.startsWith("/dashboard/vessels/browse/")
    );
  }
  if (href === "/dashboard/vessels") {
    return (
      pathname === "/dashboard/vessels" ||
      pathname === "/dashboard/vessels/register" ||
      (pathname.startsWith("/dashboard/vessels/") &&
        !pathname.startsWith("/dashboard/vessels/browse"))
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardSidebar({ mobileOpen, onClose }: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const { account, isLoadingAccount, hasCargoProfile, hasVesselProfile } =
    useDashboard();

  const navSections = buildNavSections(hasCargoProfile, hasVesselProfile);

  const handleLogout = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await logout(supabase);
      router.push("/auth/login");
    } catch {
      toast.error("Failed to sign out. Please try again.");
    }
  };

  const tierConfig = account?.trustTier
    ? TRUST_TIER_CONFIG[account.trustTier]
    : null;
  const TierIcon = tierConfig?.icon;

  const profileLabel = (() => {
    if (!account) return "";
    if (account.hasCargoProfile && account.hasVesselProfile) return "Broker";
    if (account.hasCargoProfile) return "Cargo";
    if (account.hasVesselProfile) return "Vessel";
    return "";
  })();

  const initials =
    account?.fullName
      ?.split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "—";

  const sidebarContent = (
    <div className="flex h-full flex-col overflow-hidden bg-asb-white">
      {/* Brand header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-asb-gray-200 px-4">
        <Link
          href="/"
          onClick={onClose}
          className="flex items-center gap-2.5 focus:outline-none"
          aria-label="Arab ShipBroker home"
        >
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-asb-gray-200 bg-asb-gray-50">
            <Image
              src="/logo.png"
              alt="Arab ShipBroker"
              fill
              className="object-contain p-1"
            />
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-medium text-asb-navy">
              Arab ShipBroker
            </p>
            <p className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-asb-gray-500">
              Portal
            </p>
          </div>
        </Link>

        {mobileOpen && (
          <button
            onClick={onClose}
            className="inline-flex rounded p-1.5 text-asb-gray-500 transition-colors hover:bg-asb-gray-50 hover:text-asb-ink lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        {isLoadingAccount ? (
          <div className="flex items-center justify-center py-10 text-asb-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          navSections.map((section) => (
            <div key={section.label} className="mb-1">
              <p className="px-3.5 pb-1 pt-3 text-[10px] font-normal uppercase tracking-[0.09em] text-asb-gray-500">
                {section.label}
              </p>
              {section.links.map((link) => {
                const active =
                  !link.disabled && isNavLinkActive(pathname, link.href);
                const Icon = link.icon;
                if (link.disabled) {
                  return (
                    <button
                      key={link.href + link.label}
                      type="button"
                      className="nav-item is-disabled"
                      title={link.tooltip}
                      aria-disabled
                    >
                      <Icon className="nav-icon" />
                      <span className="flex-1">{link.label}</span>
                    </button>
                  );
                }
                return (
                  <Link
                    key={link.href + link.label}
                    href={link.href}
                    onClick={onClose}
                    className={cn("nav-item", active && "is-active")}
                  >
                    <Icon className="nav-icon" />
                    <span className="flex-1">{link.label}</span>
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </nav>

      {/* Footer: trust tier + user + sign out */}
      <div className="shrink-0 border-t border-asb-gray-200 p-2.5">
        {tierConfig && TierIcon && account && (
          <div
            className={cn(
              "mb-2 flex items-center gap-2 rounded px-2.5 py-2 text-[11px]",
              tierConfig.bg,
              tierConfig.text,
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tierConfig.dot)}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium leading-none">
                {tierConfig.label}
              </p>
              <p className="mt-0.5 truncate opacity-70">{tierConfig.hint}</p>
            </div>
            <TierIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </div>
        )}

        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-asb-blue-light text-[12px] font-medium text-asb-blue">
            {initials}
          </div>
          <div className="min-w-0 flex-1 leading-none">
            <p className="truncate text-[12px] font-medium text-asb-ink">
              {isLoadingAccount ? "Loading…" : (account?.fullName ?? "—")}
            </p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.1em] text-asb-gray-500">
              {profileLabel || "Platform user"}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="mt-1 flex w-full items-center gap-2.5 rounded px-3.5 py-2 text-[12px] text-asb-gray-500 transition-colors hover:bg-asb-red-bg hover:text-asb-red"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-asb-navy/30 backdrop-blur-sm transition-opacity duration-200 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 h-full w-[80vw] max-w-[220px] transform border-r border-asb-gray-200 transition-transform duration-200 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </div>

      {/* Desktop fixed sidebar — 180px per tokens.css */}
      <div className="fixed inset-y-0 left-0 z-30 w-[180px] border-r border-asb-gray-200 max-lg:hidden">
        {sidebarContent}
      </div>
    </>
  );
}
