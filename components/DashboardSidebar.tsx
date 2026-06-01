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
};

type NavSection = {
  label: string;
  links: NavLink[];
};

const TRUST_TIER_CONFIG = {
  NEW: {
    label: "New Account",
    icon: Clock,
    className: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    hint: "Posts held for review",
    dot: "bg-amber-400",
  },
  VERIFIED: {
    label: "Verified",
    icon: CheckCircle2,
    className: "text-foam-400 bg-foam-400/10 border-foam-400/20",
    hint: "Posts go live instantly",
    dot: "bg-foam-400",
  },
  FLAGGED: {
    label: "Flagged",
    icon: AlertTriangle,
    className: "text-coral-400 bg-coral-400/10 border-coral-400/20",
    hint: "Contact support",
    dot: "bg-coral-500",
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

  sections.push({
    label: "Account",
    links: [{ label: "Settings", href: "/dashboard/account", icon: User }],
  });

  const workspaceLinks: NavLink[] = [
    { label: "Circular Parser", href: "/dashboard/circulars", icon: Sparkles },
    { label: "Voyage Estimator", href: "/dashboard/voyage-estimator", icon: Calculator },
  ];
  if (hasCargoProfile) {
    workspaceLinks.push(
      { label: "My Listings", href: "/dashboard/cargo/my", icon: Package },
      {
        label: "Post Cargo",
        href: "/dashboard/cargo/create",
        icon: Plus,
      },
    );
  }
  if (hasVesselProfile) {
    workspaceLinks.push({
      label: "My Vessels",
      href: "/dashboard/vessels",
      icon: Ship,
    });
  }
  if (workspaceLinks.length > 0) {
    sections.push({ label: "Workspace", links: workspaceLinks });
  }

  const discoverLinks: NavLink[] = [];
  if (hasCargoProfile || hasVesselProfile) {
    if (!hasCargoProfile) {
      discoverLinks.push({
        label: "Browse Cargo",
        href: "/dashboard/cargo",
        icon: Package,
      });
    } else {
      discoverLinks.push({
        label: "Market Cargo",
        href: "/dashboard/cargo",
        icon: Search,
      });
    }
    discoverLinks.push({
      label: "Open Vessels",
      href: "/dashboard/vessels/browse",
      icon: Search,
    });
  }
  if (discoverLinks.length > 0) {
    sections.push({ label: "Discover", links: discoverLinks });
  }

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

export function DashboardSidebar({
  mobileOpen,
  onClose,
}: DashboardSidebarProps) {
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

  const sidebarContent = (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{ background: "#060d1f" }}
    >
      <div
        className="absolute top-0 inset-x-0 h-48 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% -20%, rgba(16,163,188,0.07) 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative h-15.5 px-4 flex items-center justify-between shrink-0 border-b border-white/6">
        <Link
          href="/"
          onClick={onClose}
          className="flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-foam-400/50"
          aria-label="Arab ShipBroker home"
        >
          <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
            <Image
              src="/logo.png"
              alt="Arab ShipBroker"
              fill
              className="object-contain p-1 brightness-0 invert"
            />
          </div>
          <div className="leading-none">
            <p className="font-bold text-white text-[13.5px] tracking-tight">
              Arab ShipBroker
            </p>
            <p className="text-[9px] font-bold text-foam-400/60 uppercase tracking-[0.22em] mt-0.75">
              Broker Portal
            </p>
          </div>
        </Link>

        {mobileOpen && (
          <button
            onClick={onClose}
            className="hidden max-lg:inline-flex p-1.5 text-white/30 hover:text-white/60 rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 min-h-0 px-3 py-4 overflow-y-auto sidebar-scroll space-y-5 relative">
        {isLoadingAccount ? (
          <div className="flex items-center justify-center py-10 text-white/20">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          navSections.map((section) => (
            <div key={section.label}>
              <p className="sidebar-section-label">{section.label}</p>
              <div className="space-y-0.5">
                {section.links.map((link) => {
                  const active = isNavLinkActive(pathname, link.href);
                  return (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      onClick={onClose}
                      className={cn(
                        "sidebar-item group",
                        active
                          ? "sidebar-item-active"
                          : "sidebar-item-inactive",
                      )}
                    >
                      <span
                        className={cn(
                          "w-0.5 h-4 rounded-full shrink-0 transition-all duration-150",
                          active ? "bg-foam-400" : "bg-transparent",
                        )}
                        aria-hidden
                      />

                      <link.icon
                        className={cn(
                          "w-4 h-4 shrink-0 transition-colors duration-150",
                          active
                            ? "text-foam-400"
                            : "text-white/30 group-hover:text-white/55",
                        )}
                      />

                      <span
                        className={cn(
                          "text-sm transition-colors duration-150",
                          active ? "font-semibold" : "font-medium",
                        )}
                      >
                        {link.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </nav>

      <div className="relative px-3 py-4 border-t border-white/6 shrink-0 space-y-2">
        {tierConfig && TierIcon && account && (
          <div
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-medium",
              tierConfig.className,
            )}
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {account.trustTier === "VERIFIED" && (
                <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-foam-400 opacity-50" />
              )}
              <span
                className={cn(
                  "relative inline-flex rounded-full h-1.5 w-1.5",
                  tierConfig.dot,
                )}
              />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate leading-none">
                {tierConfig.label}
              </p>
              <p className="opacity-60 font-normal truncate mt-0.5">
                {tierConfig.hint}
              </p>
            </div>
            <TierIcon className="w-3.5 h-3.5 shrink-0 opacity-60" />
          </div>
        )}

        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-white/4 rounded-xl border border-white/6">
          <div className="w-7 h-7 bg-ocean-700/60 border border-ocean-600/30 rounded-full flex items-center justify-center shrink-0">
            <User className="w-3.5 h-3.5 text-ocean-200" />
          </div>
          <div className="flex-1 overflow-hidden leading-none">
            <p className="text-xs font-semibold text-white/85 truncate">
              {isLoadingAccount ? "Loading…" : (account?.fullName ?? "—")}
            </p>
            <p className="text-[10px] font-medium text-white/30 uppercase tracking-[0.14em] truncate mt-0.75">
              {profileLabel || "Platform user"}
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-2 text-xs font-medium text-white/30 hover:text-red-400/80 hover:bg-red-400/8 rounded-xl transition-all duration-150"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-ocean-950/70 backdrop-blur-sm hidden max-lg:block transition-opacity duration-300",
          mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden
      />

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 h-full w-[80vw] max-w-68 transform transition-transform duration-300 ease-out hidden max-lg:block",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {sidebarContent}
      </div>

      <div className="fixed inset-y-0 left-0 w-64 z-30 max-lg:hidden">
        {sidebarContent}
      </div>
    </>
  );
}
