"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentUser } from "@/sdk/auth";
import type { AccountWithProfiles } from "@/lib/schemas/account";

interface DashboardContextType {
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;

  account: AccountWithProfiles | null;
  isLoadingAccount: boolean;
  accountError: string | null;

  hasCargoProfile: boolean;
  hasVesselProfile: boolean;
  hasBothProfiles: boolean;

  refreshAccount: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined,
);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [account, setAccount] = useState<AccountWithProfiles | null>(null);
  const [isLoadingAccount, setIsLoadingAccount] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    setIsLoadingAccount(true);
    setAccountError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const data = await getCurrentUser(supabase);
      setAccount(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load account";
      setAccountError(msg);
      setAccount(null);
    } finally {
      setIsLoadingAccount(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  const hasCargoProfile = account?.hasCargoProfile ?? false;
  const hasVesselProfile = account?.hasVesselProfile ?? false;
  const hasBothProfiles = hasCargoProfile && hasVesselProfile;

  return (
    <DashboardContext.Provider
      value={{
        isSidebarCollapsed,
        setSidebarCollapsed,
        account,
        isLoadingAccount,
        accountError,
        hasCargoProfile,
        hasVesselProfile,
        hasBothProfiles,
        refreshAccount: loadAccount,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context)
    throw new Error("useDashboard must be used within a DashboardProvider");
  return context;
}

export function useHasCargoProfile(): boolean {
  return useDashboard().hasCargoProfile;
}

export function useHasVesselProfile(): boolean {
  return useDashboard().hasVesselProfile;
}

export function useAccount(): AccountWithProfiles | null {
  return useDashboard().account;
}
