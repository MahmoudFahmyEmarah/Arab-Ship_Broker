"use server";

import { getAppUserRow } from "@/lib/app-user";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

async function buildServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );
}

type ActionResult = { success: true } | { success: false; error: string };

export async function updateBasicInfo(
  full_name: string,
): Promise<ActionResult> {
  const supabase = await buildServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const row = await getAppUserRow(supabase, user.id, "id");
  if (!row) return { success: false, error: "Account record not found." };
  const { error } = await supabase
    .from("users")
    .update({ full_name: full_name.trim() })
    .eq("id", row.id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/account");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateProfileInfo(
  profile_type: "cargo" | "vessel",
  fields: {
    display_name?: string;
    company?: string;
    phone?: string;
    notes?: string;
  },
): Promise<ActionResult> {
  const supabase = await buildServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const appUser = await getAppUserRow(supabase, user.id, "id");
  if (!appUser) return { success: false, error: "User record not found." };

  const payload: Record<string, string | null> = {};
  if (fields.display_name !== undefined)
    payload.display_name = fields.display_name.trim() || null;
  if (fields.company !== undefined)
    payload.company = fields.company.trim() || null;
  if (fields.phone !== undefined) payload.phone = fields.phone.trim() || null;
  if (fields.notes !== undefined) payload.notes = fields.notes.trim() || null;

  const { error } = await supabase
    .from("profiles")
    .update(payload)
    .eq("account_id", appUser.id)
    .eq("profile_type", profile_type);

  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/account");
  return { success: true };
}

export async function requestEmailChange(
  new_email: string,
): Promise<ActionResult> {
  const supabase = await buildServerClient();
  const { error } = await supabase.auth.updateUser({
    email: new_email.trim().toLowerCase(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updatePassword(
  current_password: string,
  new_password: string,
): Promise<ActionResult> {
  const supabase = await buildServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { success: false, error: "Not authenticated." };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });

  if (signInError)
    return { success: false, error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({ password: new_password });
  if (error) return { success: false, error: error.message };

  return { success: true };
}

// Real self-serve account erasure. Commercial history keeps an anonymous
// app-user UUID, so the database scrubs mutable PII/access first and Auth is
// then soft-deleted. This avoids breaking immutable PDA/Fixture audit rows.
export async function deleteMyAccount(): Promise<ActionResult> {
  const supabase = await buildServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    return { success: false, error: "Account deletion isn't available right now." };
  }

  const { error: anonymizeError } = await admin.rpc("fn_anonymize_account", {
    p_auth_user_id: user.id,
  });
  if (anonymizeError) {
    return {
      success: false,
      error: `Account erasure could not be completed: ${anonymizeError.message}`,
    };
  }

  // A hard delete would cascade through public.users and collide with retained
  // audit history. Supabase soft deletion removes the login's identifying data
  // while preserving the FK anchor.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(
    user.id,
    true,
  );
  if (authDeleteError) {
    return {
      success: false,
      error:
        "Your application data was anonymized, but sign-in removal is still pending. Please contact support.",
    };
  }

  return { success: true };
}
