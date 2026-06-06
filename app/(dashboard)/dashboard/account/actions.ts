"use server";

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

  const { error } = await supabase
    .from("users")
    .update({ full_name: full_name.trim() })
    .eq("id", user.id);

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

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .single();

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

// Real self-serve account deletion. Removes the app account row (cascades to
// profiles) and the Supabase auth user via the service-role admin client, so
// the login is permanently gone. Irreversible.
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

  // Remove the app account row (profiles cascade via account_id ON DELETE
  // CASCADE). Match on either key shape to be safe.
  await admin.from("users").delete().eq("supabase_user_id", user.id);
  await admin.from("users").delete().eq("id", user.id);

  // Remove the auth login itself.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { success: false, error: error.message };

  return { success: true };
}
