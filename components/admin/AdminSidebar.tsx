"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LogOut,
  LayoutDashboard,
  ClipboardList,
  Users,
  Package,
  Ship,
  MapPin,
  Layers,
  HelpCircle,
  Mail,
  X,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { logout } from "@/sdk/auth";

interface AdminSidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Moderation",
    items: [
      { label: "Review Queue", href: "/admin/queue", icon: ClipboardList },
      { label: "Cargo Listings", href: "/admin/cargo", icon: Package },
      {
        label: "Vessel Availability",
        href: "/admin/vessel-availability",
        icon: Ship,
      },
    ],
  },
  {
    label: "Registry",
    items: [
      { label: "Vessel Intel", href: "/admin/vessels", icon: Ship },
      { label: "Ports", href: "/admin/ports", icon: MapPin },
      { label: "Commodities", href: "/admin/commodities", icon: Layers },
      {
        label: "Safety Questions",
        href: "/admin/safety-questions",
        icon: HelpCircle,
      },
    ],
  },
  {
    label: "Platform",
    items: [
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Messages", href: "/admin/messages", icon: Mail },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin/dashboard") return pathname === "/admin/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ mobileOpen, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      await logout(supabase);
      router.push("/auth/login");
    } catch {
      toast.error("Failed to sign out.");
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-100">
      <div className="h-15.5 px-4 flex items-center justify-between shrink-0 border-b border-slate-100">
        <Link
          href="/admin/dashboard"
          onClick={onClose}
          className="flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400/40"
        >
          <div className="relative w-8 h-8 rounded-lg overflow-hidden border border-ocean-100 bg-ocean-50 shrink-0 flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="Arab ShipBroker"
              fill
              className="object-contain p-1"
            />
          </div>
          <div className="leading-none">
            <p className="text-[13px] font-bold text-slate-900 tracking-tight">
              Arab ShipBroker
            </p>
            <p className="text-[9px] font-bold text-coral-600 uppercase tracking-[0.22em] mt-0.75">
              Admin Console
            </p>
          </div>
        </Link>

        {mobileOpen && (
          <button
            onClick={onClose}
            className="hidden max-lg:inline-flex p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 sidebar-scroll space-y-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 mb-1.5 text-[10px] font-bold text-slate-400/80 uppercase tracking-[0.14em]">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150",
                      active
                        ? "bg-ocean-50 text-ocean-700 font-semibold"
                        : "text-slate-500 font-medium hover:bg-slate-50/80 hover:text-slate-800",
                    )}
                  >
                    <span
                      className={cn(
                        "w-0.5 h-4 rounded-full shrink-0 transition-all duration-150",
                        active ? "bg-ocean-500" : "bg-transparent",
                      )}
                      aria-hidden
                    />

                    <Icon
                      className={cn(
                        "w-4 h-4 shrink-0 transition-colors duration-150",
                        active
                          ? "text-ocean-600"
                          : "text-slate-400 group-hover:text-slate-600",
                      )}
                    />

                    <span className="flex-1 truncate">{item.label}</span>

                    {item.badge && (
                      <span className="ml-auto text-[10px] font-bold bg-coral-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                        {item.badge}
                      </span>
                    )}

                    {active && (
                      <ChevronRight className="w-3.5 h-3.5 text-ocean-400/60 shrink-0" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100 shrink-0 space-y-1.5">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-ocean-50 rounded-xl border border-ocean-100/80 mb-1">
          <div className="w-7 h-7 bg-ocean-600 rounded-full flex items-center justify-center shrink-0 shadow-inner">
            <ShieldCheck className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="flex-1 overflow-hidden leading-none">
            <p className="text-xs font-bold text-ocean-900 truncate">
              Administrator
            </p>
            <p className="text-[10px] text-ocean-500 mt-0.5 font-medium">
              Full platform access
            </p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-150"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm hidden max-lg:block transition-opacity duration-300",
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
