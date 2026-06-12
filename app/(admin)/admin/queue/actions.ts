"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireAdmin } from "@/lib/admin/require-admin";

async function getServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
}

async function executeReviewAction(
  queueItemId: string,
  newStatus: "APPROVED" | "REJECTED" | "FLAGGED",
  actionTaken: "approved" | "rejected" | "amended" | "flagged",
  amendmentDetail: string | null,
  adminUserId: string,
) {
  const supabase = await getServerClient();

  const { data: item, error: fetchErr } = await supabase
    .from("review_queue")
    .select("id, status, listing_type, listing_id, submitted_by")
    .eq("id", queueItemId)
    .single();

  if (fetchErr || !item) throw new Error("Queue item not found.");
  if (item.status !== "PENDING")
    throw new Error(`Item already reviewed (status: ${item.status}).`);

  const { error: updateErr } = await supabase
    .from("review_queue")
    .update({
      status: newStatus,
      action_taken: actionTaken,
      amendment_detail: amendmentDetail ?? null,
      reviewed_by: adminUserId,
    })
    .eq("id", queueItemId);

  if (updateErr) throw new Error(`Review failed: ${updateErr.message}`);
  return item as {
    id: string;
    status: string;
    listing_type: string;
    listing_id: string;
    submitted_by: string;
  };
}

export async function approveQueueItem(queueItemId: string) {
  const admin = await requireAdmin({ section: "review", edit: true });
  try {
    await executeReviewAction(
      queueItemId,
      "APPROVED",
      "approved",
      null,
      admin.supabaseUserId,
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Approval failed.",
    };
  }
  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function rejectQueueItem(queueItemId: string, reason: string) {
  const admin = await requireAdmin({ section: "review", edit: true });
  if (!reason.trim())
    return { success: false, error: "A rejection reason is required." };
  try {
    await executeReviewAction(
      queueItemId,
      "REJECTED",
      "rejected",
      reason.trim(),
      admin.supabaseUserId,
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Rejection failed.",
    };
  }
  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function amendQueueItem(
  queueItemId: string,
  amendmentDetail: string,
) {
  const admin = await requireAdmin({ section: "review", edit: true });
  if (!amendmentDetail.trim())
    return { success: false, error: "Amendment details are required." };
  try {
    await executeReviewAction(
      queueItemId,
      "APPROVED",
      "amended",
      amendmentDetail.trim(),
      admin.supabaseUserId,
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Amendment failed.",
    };
  }
  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function flagQueueItem(queueItemId: string, reason: string) {
  const admin = await requireAdmin({ section: "review", edit: true });
  if (!reason.trim())
    return { success: false, error: "A flag reason is required." };
  try {
    await executeReviewAction(
      queueItemId,
      "FLAGGED",
      "flagged",
      reason.trim(),
      admin.supabaseUserId,
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Flag action failed.",
    };
  }
  revalidatePath("/admin/queue");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
