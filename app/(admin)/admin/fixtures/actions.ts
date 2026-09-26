"use server";

// Admin → Fixture rooms · mutating actions (26 Sep 2026).
//
// Every write goes through the governed RPCs with the ADMIN'S OWN session,
// never the service role: the database decides what an admin is
// (fn_is_admin(), the JWT claim), attributes the event to the platform party
// and records the actor. A form carries the idempotency key it was rendered
// with, so a resubmitted form replays instead of repeating (the same contract
// the member room follows).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";
import * as sdk from "@/sdk/app/fixtures";
import { closeRoomSchema, redactMessageSchema } from "@/lib/fixture-room/schemas";
import { FIXTURE_ERROR_TITLE } from "@/lib/fixture-room/errors";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function finish(roomId: string, message: string, error = false): never {
  revalidatePath(`/admin/fixtures/${roomId}`);
  revalidatePath("/admin/fixtures");
  redirect(`/admin/fixtures/${roomId}?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

/** Redact one message (its text is withheld from every reader; the event stays). */
export async function redactFixtureMessageAdmin(form: FormData) {
  await requireAdmin({ section: "fixtures", edit: true });
  const roomId = text(form, "roomId");
  const parsed = redactMessageSchema.safeParse({
    roomId,
    messageId: text(form, "messageId"),
    reason: text(form, "reason"),
    expectedVersion: Number(text(form, "expectedVersion")),
    idempotencyKey: text(form, "idempotencyKey"),
  });
  if (!parsed.success) finish(roomId, parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), true);
  const res = await sdk.redactFixtureMessage(await getAdminSupabaseClient(), parsed.data);
  if (!res.ok) finish(roomId, `${FIXTURE_ERROR_TITLE[res.code]}: ${res.message}`, true);
  finish(roomId, res.replayed ? "That redaction had already been applied (replayed)." : `Message redacted · room now v${res.version}.`);
}

/** Close a room as failed or expired (the platform party's coordination command). */
export async function closeFixtureRoomAdmin(form: FormData) {
  await requireAdmin({ section: "fixtures", edit: true });
  const roomId = text(form, "roomId");
  const parsed = closeRoomSchema.safeParse({
    roomId,
    reason: text(form, "reason"),
    note: text(form, "note") || null,
    expectedVersion: Number(text(form, "expectedVersion")),
    idempotencyKey: text(form, "idempotencyKey"),
  });
  if (!parsed.success) finish(roomId, parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), true);
  if (parsed.data.reason === "withdrawn") finish(roomId, "Withdrawal belongs to a principal; the platform marks a room failed or expired.", true);
  const res = await sdk.closeFixtureRoom(await getAdminSupabaseClient(), parsed.data);
  if (!res.ok) finish(roomId, `${FIXTURE_ERROR_TITLE[res.code]}: ${res.message}`, true);
  finish(roomId, res.replayed ? "That close had already been applied (replayed)." : `Room closed as ${parsed.data.reason} · v${res.version}.`);
}
