"use server";

import { createUser } from "@/sdk/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ProfileType } from "@/lib/schemas/account";
import { validateProfileSelection } from "@/lib/schemas/account";

type SignupInput = {
  name: string;
  email: string;
  password: string;
  profiles: ProfileType[];
};

export async function signupAction(data: SignupInput) {
  try {
    const profileSel = {
      cargo: data.profiles.includes("cargo"),
      vessel: data.profiles.includes("vessel"),
    };
    const validationError = validateProfileSelection(profileSel);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const supabaseAdmin = getSupabaseAdminClient();
    await createUser(supabaseAdmin, {
      name: data.name,
      email: data.email,
      password: data.password,
      profiles: data.profiles,
    });

    return { success: true };
  } catch (error) {
    console.error("Signup error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create account",
    };
  }
}
