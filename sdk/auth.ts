import { SupabaseClient } from "@supabase/supabase-js";
import type { AccountWithProfiles, ProfileType } from "@/lib/schemas/account";
import { normalizeRole } from "@/lib/role";

export class EmailNotVerifiedError extends Error {
  email: string;
  otpSent: boolean;

  constructor(email: string, otpSent: boolean) {
    super("Email is not verified.");
    this.name = "EmailNotVerifiedError";
    this.email = email;
    this.otpSent = otpSent;
  }
}

function isUnverifiedEmailMessage(message: string | undefined) {
  const normalized = message?.toLowerCase() ?? "";
  return (
    normalized.includes("email not confirmed") ||
    normalized.includes("email not verified") ||
    normalized.includes("confirm your email")
  );
}

async function resendSignupOtp(
  supabase: SupabaseClient,
  email: string,
): Promise<boolean> {
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
  });

  if (error) {
    console.warn("Failed to resend verification OTP:", error.message);
    return false;
  }

  return true;
}

export async function createUser(
  supabaseAdmin: SupabaseClient,
  params: {
    name: string;
    email: string;
    password: string;
    profiles: ProfileType[];
  },
) {
  if (!params.profiles || params.profiles.length === 0) {
    throw new Error("At least one profile type must be selected.");
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: params.email,
      password: params.password,
      email_confirm: false,
      user_metadata: {
        full_name: params.name,
        profiles: params.profiles,
      },
    });

  if (authError) throw new Error(authError.message);
  if (!authData.user) throw new Error("Failed to create user in Auth system.");

  const { error: rpcError } = await supabaseAdmin.rpc(
    "create_account_with_profiles",
    {
      p_supabase_user_id: authData.user.id,
      p_name: params.name,
      p_email: params.email,
      p_profiles: params.profiles,
    },
  );

  if (rpcError) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    throw new Error(`Failed to create account profile: ${rpcError.message}`);
  }

  const { error: resendError } = await supabaseAdmin.auth.resend({
    type: "signup",
    email: params.email,
  });

  if (resendError) {
    console.warn("Failed to send verification email:", resendError.message);
  }

  return authData.user;
}

export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<AccountWithProfiles> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw authError || new Error("No authenticated user found");
  }

  // Production schema: read public.users directly (id == auth uid) and derive
  // the cargo/vessel personas from `role` — prod has no `profiles` table or
  // `v_account_profiles` view.
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, trust_tier, is_active, role")
    .eq("id", authData.user.id)
    .single();

  if (error) throw error;

  const role = normalizeRole(data.role);
  const hasCargoProfile = role === "cargo_owner" || role === "broker";
  const hasVesselProfile = role === "vessel_owner" || role === "broker";
  const activeProfiles: ProfileType[] = [
    ...(hasCargoProfile ? (["cargo"] as ProfileType[]) : []),
    ...(hasVesselProfile ? (["vessel"] as ProfileType[]) : []),
  ];

  return {
    supabaseUserId: data.id,
    email: data.email,
    accountId: data.id,
    fullName: data.full_name,
    trustTier: data.trust_tier as "NEW" | "VERIFIED" | "FLAGGED",
    isActive: data.is_active,
    hasCargoProfile,
    hasVesselProfile,
    activeProfiles,
  };
}

export async function verifyEmailOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "signup",
  });
  if (error) throw error;
  return data;
}

export async function login(
  supabase: SupabaseClient,
  params: { email: string; password: string },
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  if (error) {
    if (isUnverifiedEmailMessage(error.message)) {
      const otpSent = await resendSignupOtp(supabase, params.email);
      throw new EmailNotVerifiedError(params.email, otpSent);
    }
    throw error;
  }

  const userEmail = data.user?.email ?? params.email;
  const isEmailVerified = Boolean(data.user?.email_confirmed_at);

  if (!isEmailVerified) {
    const otpSent = await resendSignupOtp(supabase, userEmail);
    await supabase.auth.signOut({ scope: "local" });
    throw new EmailNotVerifiedError(userEmail, otpSent);
  }

  return data;
}

export async function sendForgotPasswordEmail(
  supabase: SupabaseClient,
  email: string,
) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
  return data;
}

export async function verifyRecoveryOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "recovery",
  });
  if (error) throw error;
  return data;
}

export async function resetPassword(
  supabase: SupabaseClient,
  newPassword: string,
) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
  return data;
}

export async function logout(supabase: SupabaseClient) {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}
