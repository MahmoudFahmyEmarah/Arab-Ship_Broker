// Fixture Room · masking guard (23 Sep 2026; TBN identifiers added 25 Sep, audit FR-H3).
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** Every string equal to the given id anywhere in the payload (a stable identifier that must not be there). */
function findId(node: unknown, id: string, path: string, out: string[]) {
  if (Array.isArray(node)) { node.forEach((x, i) => findId(x, id, `${path}[${i}]`, out)); return; }
  if (node && typeof node === "object") { for (const [k, v] of Object.entries(node as Record<string, unknown>)) findId(v, id, `${path}.${k}`, out); return; }
  if (typeof node === "string" && node.toLowerCase() === id.toLowerCase()) out.push(`${path} carries the masked vessel id`);
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
  // a masked TBN vessel: no name, no IMO and no stable identifier anywhere (FR-H3)
  if (view.snapshot.vesselIdentityMasked) {
    const vessel = view.snapshot.vessel.vessel as Record<string, unknown>;
    const availability = view.snapshot.vessel.availability as Record<string, unknown>;
    if (vessel.vessel_name && vessel.vessel_name !== "TBN") out.push("view.snapshot.vessel.vessel.vessel_name names a masked vessel");
    if (vessel.imo_number != null) out.push("view.snapshot.vessel.vessel.imo_number is set for a masked vessel");
    if (vessel.id != null) out.push("view.snapshot.vessel.vessel.id is set for a masked vessel");
    if (availability.vessel_id != null) out.push("view.snapshot.vessel.availability.vessel_id is set for a masked vessel");
    if (view.room.vesselId != null) out.push("view.room.vesselId is set for a masked vessel");
    // C2O-013: the position id identifies the hull too
    if (view.room.vesselAvailabilityId != null) out.push("view.room.vesselAvailabilityId is set for a masked vessel");
    if (availability.id != null) out.push("view.snapshot.vessel.availability.id is set for a masked vessel");
    if (view.room.listingSync?.vessel.availabilityId != null) out.push("view.room.listingSync.vessel.availabilityId is set for a masked vessel");
    // an identifier embedded in free text (a message, comment, title or note): any uuid-shaped
    // substring in a non-id string that is not one of the view's own entity ids is flagged
    for (const leak of embeddedIdentifiers(view)) out.push(leak);
    if (view.room.listingSync?.vessel.vesselId != null) out.push("view.room.listingSync.vessel.vesselId is set for a masked vessel");
    for (const id of [vessel.id, availability.vessel_id, view.room.vesselId, view.room.listingSync?.vessel.vesselId]) {
      if (typeof id === "string" && UUID.test(id)) findId(view.events, id, "view.events", out);
    }
  }
  return out;
}

// a hyphenated uuid, or a hyphenless one with the v4 layout (version 4, variant 8-b); a
// governed content or snapshot hash (32 hex, no layout) is not an identifier (C2O-015 item 6)
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}/gi;
const isIdKey = (k: string) => k === "id" || /Id$/.test(k) || /_id$/.test(k) || /Ids$/.test(k);
const isHashKey = (k: string) => /hash$/i.test(k);

/**
 * C2O-014: on a masked view no free-text string may carry an identifier. The view's own
 * entity ids (values under id-named keys) are allowed; any other uuid-shaped substring,
 * in any case and with or without hyphens, is reported with its path.
 */
export function embeddedIdentifiers(view: unknown): string[] {
  const allowed = new Set<string>();
  const collect = (v: unknown, k: string) => {
    if (typeof v === "string" && isIdKey(k)) allowed.add(v.toLowerCase().replace(/-/g, ""));
    else if (Array.isArray(v)) v.forEach((x) => collect(x, k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) collect(vv, kk);
  };
  collect(view, "");
  const out: string[] = [];
  const walk = (v: unknown, path: string, k: string) => {
    if (typeof v === "string") {
      if (isIdKey(k) || isHashKey(k)) return;
      for (const m of v.match(UUID_RE) ?? []) {
        if (!allowed.has(m.toLowerCase().replace(/-/g, ""))) out.push(`${path} carries an identifier in free text`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, k));
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, path ? `${path}.${kk}` : kk, kk);
  };
  walk(view, "view", "");
  return out;
}

