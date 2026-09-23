"use server";

import { createUser } from "@/sdk/auth";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ProfileType } from "@/lib/schemas/account";
import { validateProfileSelection } from "@/lib/schemas/account";

export type DeclaredRole =
  | "principal_owner"
  | "principal_charterer"
  | "broker_cargo"
  | "broker_vessel"
  | "broker_dual";

type SignupInput = {
  name: string;
  email: string;
  password: string;
  profiles: ProfileType[];
  declaredRole?: DeclaredRole;
  // Optional company step: register a new company (caller becomes its org
  // admin) or request to join an existing one (PENDING seat — the company's
  // admin approves; never auto-granted, per the org-claim firewall rule).
  company?: { mode: "register" | "join"; name: string } | null;
};

const ORG_TYPE_FOR_ROLE: Record<DeclaredRole, string> = {
  principal_owner: "owner",
  principal_charterer: "charterer",
  broker_cargo: "broker",
  broker_vessel: "broker",
  broker_dual: "broker",
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
    const authUser = await createUser(supabaseAdmin, {
      name: data.name,
      email: data.email,
      password: data.password,
      profiles: data.profiles,
    });

    // Resolve the app users row (create_account_with_profiles keyed it to the
    // auth uid) for the declaration + org linkage below. Best-effort: a
    // failure here must not fail the signup itself.
    try {
      const { data: appUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("supabase_user_id", authUser.id)
        .single();
      const appUserId = (appUser as { id: string } | null)?.id;
      if (!appUserId) return { success: true };

      if (data.declaredRole) {
        await supabaseAdmin
          .from("users")
          .update({ declared_role: data.declaredRole })
          .eq("id", appUserId);
      }

      const companyName = data.company?.name?.trim();
      if (data.company && companyName) {
        const orgType = ORG_TYPE_FOR_ROLE[data.declaredRole ?? "broker_dual"];
        const emailDomain = data.email.split("@")[1]?.toLowerCase() ?? null;

        if (data.company.mode === "join") {
          // Existing company → PENDING membership request (admin approves).
          // Match by normalized name; unmatched names fall through to register
          // (a brand-new empty org — no data exposure; ASB admin can merge).
          const { data: orgs } = await supabaseAdmin
            .from("organizations")
            .select("id, name")
            .ilike("name", companyName)
            .limit(1);
          const org = (orgs as { id: string; name: string }[] | null)?.[0];
          if (org) {
            await supabaseAdmin.from("organization_members").insert({
              org_id: org.id,
              user_id: appUserId,
              member_role: "broker",
              is_current: false,
              status: "pending",
              requested_company_name: org.name,
              requested_email_domain: emailDomain,
            });
            return { success: true };
          }
        }

        // Register a new company; the creator takes the org-admin seat.
        //
        // Through fn_dq_signup_create_org, not a direct insert (21 Sep 2026).
        // This is a RESTRICTED write path in lib/dq/policy.ts: signup may
        // create an organisation profile with a name, a type and one email
        // domain, and the function has no parameter for anything else — no
        // subscription tier, no IMO, no fleet counts, no link fields. The
        // limit is the signature, so it cannot be widened here by accident.
        const { data: newOrgId, error: orgError } = await supabaseAdmin.rpc("fn_dq_signup_create_org", {
          p_name: companyName,
          p_org_type: orgType,
          p_email_domain: emailDomain,
        });
        if (orgError) {
          // the member's account exists; only the company profile failed, and
          // an ASB admin can attach one. Never fail the signup for it.
          console.error("signup: organisation profile not created", orgError.message);
        }
        if (newOrgId) {
          await supabaseAdmin.from("organization_members").insert({
            org_id: newOrgId as string,
            user_id: appUserId,
            member_role: "admin",
            is_current: true,
            status: "active",
          });
        }
      }
    } catch (orgError) {
      console.error("Signup org-step error (account still created):", orgError);
    }

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
