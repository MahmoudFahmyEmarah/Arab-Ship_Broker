// Fixture Room · masking guard (23 Sep 2026).
//
// The server masks before serialisation; this is a belt-and-braces check the
// tests run over member views and the server actions run in development. It
// never repairs a payload: a leak is a defect to raise, not to hide.
import type { FixtureRoomView } from "./types";

const FORBIDDEN_KEYS = new Set([
  "orgId", "userId", "contactId", "anchorListingId", "anchorListingType",
  "actorUserId", "createdByUserId", "createdByPartyId", "closedByUserId", "createIdempotencyKey",
  "invitedByUserId", "disclosureAgreedAt", "idempotencyKey",
  "email", "phone", "desk_email", "desk_phone", "email_general", "email_chartering", "pic_name", "pic_role",
  "owner_company", "owner_address", "manager_company", "manager_address", "notes", "broker",
]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /\+\d[\d\s().-]{7,}\d/;

function walk(node: unknown, path: string, out: string[]) {
  if (Array.isArray(node)) {
    node.forEach((x, i) => walk(x, `${path}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) out.push(`${path}.${k}`);
      walk(v, `${path}.${k}`, out);
    }
    return;
  }
  if (typeof node === "string") {
    if (EMAIL.test(node)) out.push(`${path} looks like an email`);
    if (PHONE.test(node)) out.push(`${path} looks like a phone number`);
  }
}

/** Paths in a MEMBER view that should never be there. Empty means clean. Admin views are exempt. */
export function findMaskingLeaks(view: FixtureRoomView): string[] {
  if (view.viewer.isAdmin) return [];
  const out: string[] = [];
  walk(view, "view", out);
  // a counterparty principal must be a label until disclosure
  if (!view.room.counterpartyDisclosed) {
    for (const p of view.parties) {
      const own = p.isViewer || (view.viewer.side !== null && p.side === view.viewer.side) || p.isPlatform;
      if (!own && p.capacity === "principal" && (p.name || p.deskLabel)) out.push(`view.parties[${p.id}] names an undisclosed counterparty`);
    }
  }
  return out;
}
