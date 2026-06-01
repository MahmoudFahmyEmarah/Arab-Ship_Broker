"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Package, Ship, ArrowRight, Loader2 } from "lucide-react";
import { useDashboard } from "@/contexts/DashboardContext";
import type { ProfileType } from "@/lib/schemas/account";

interface ProfileGuardProps {
  requires: ProfileType;
  children: ReactNode;
}

const PROFILE_META: Record<
  ProfileType,
  {
    label: string;
    description: string;
    icon: React.ElementType;
    addHref: string;
  }
> = {
  cargo: {
    label: "Cargo Profile",
    description:
      "You need a Cargo profile to post cargo listings and run cargo matchmaking.",
    icon: Package,
    addHref: "/dashboard/profile/add-cargo",
  },
  vessel: {
    label: "Vessel Profile",
    description:
      "You need a Vessel profile to post vessel availability and find cargo matches.",
    icon: Ship,
    addHref: "/dashboard/profile/add-vessel",
  },
};

export function ProfileGuard({ requires, children }: ProfileGuardProps) {
  const { isLoadingAccount, hasCargoProfile, hasVesselProfile } =
    useDashboard();

  if (isLoadingAccount) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const hasProfile = requires === "cargo" ? hasCargoProfile : hasVesselProfile;

  if (hasProfile) {
    return <>{children}</>;
  }

  const meta = PROFILE_META[requires];
  const Icon = meta.icon;

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto w-14 h-14 bg-ocean-50 border border-ocean-100 rounded-2xl flex items-center justify-center mb-5">
          <Icon className="w-7 h-7 text-ocean-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">
          {meta.label} Required
        </h2>
        <p className="text-slate-500 text-sm mb-6">{meta.description}</p>
        <Link
          href={meta.addHref}
          className="inline-flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          Activate {meta.label}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="text-xs text-slate-400 mt-4">
          <Link href="/dashboard" className="underline hover:text-slate-600">
            Back to Overview
          </Link>
        </p>
      </div>
    </div>
  );
}
