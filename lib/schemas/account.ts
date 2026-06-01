export const PROFILE_TYPES = ["cargo", "vessel"] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export type Profile = {
  id: string;
  account_id: string;
  profile_type: ProfileType;
  display_name: string | null;
  company: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AccountWithProfiles = {
  supabaseUserId: string;
  email: string;

  accountId: string;
  fullName: string;
  trustTier: "NEW" | "VERIFIED" | "FLAGGED";
  isActive: boolean;

  hasCargoProfile: boolean;
  hasVesselProfile: boolean;
  activeProfiles: ProfileType[];
};

export type SignupProfileSelection = {
  cargo: boolean;
  vessel: boolean;
};

export function validateProfileSelection(
  sel: SignupProfileSelection,
): string | null {
  if (!sel.cargo && !sel.vessel) {
    return "Please select at least one profile type.";
  }
  return null;
}

export function profileSelectionToArray(
  sel: SignupProfileSelection,
): ProfileType[] {
  const result: ProfileType[] = [];
  if (sel.cargo) result.push("cargo");
  if (sel.vessel) result.push("vessel");
  return result;
}
