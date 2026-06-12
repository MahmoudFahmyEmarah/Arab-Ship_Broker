"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function client() {
  await requireAdmin({ section: "safety", edit: true });
  return getSupabaseAdminClient();
}

export async function setSafetyQuestionActive(id: string, isActive: boolean) {
  const c = await client();
  const { error } = await c
    .from("safety_questions")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/safety-questions");
  return { success: true };
}

export async function updateSafetyQuestion(
  id: string,
  fields: Partial<{
    question_text: string;
    answer_type: string;
    select_options: string[];
    is_required: boolean;
    is_matchmaking_field: boolean;
    matchmaking_column: string | null;
    section_label: string | null;
    help_text: string | null;
    sort_order: number;
  }>,
) {
  const c = await client();
  const { error } = await c
    .from("safety_questions")
    .update(fields)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/safety-questions");
  return { success: true };
}

export async function createSafetyQuestion(fields: {
  question_key: string;
  question_text: string;
  answer_type: string;
  applies_to_cargo_type: string[];
  applies_to_categories: string[];
  is_required: boolean;
  is_matchmaking_field: boolean;
  matchmaking_column?: string;
  section_label?: string;
  help_text?: string;
  select_options?: string[];
  sort_order: number;
}) {
  const c = await client();
  const { error } = await c.from("safety_questions").insert({
    ...fields,
    is_active: true,
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/safety-questions");
  return { success: true };
}
