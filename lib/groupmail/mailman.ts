// Mailman 2.1 admin-interface driver (server-only). cPanel manages Mailman
// list creation but exposes NO API for membership, so member CRUD drives the
// list's own admin web interface — the same pages the "Manage" button in
// cPanel opens — using the list admin password stored in Vault.
//
// URL shape: {base}/admin/{listid}/... where listid = local_domain
// (circulation_arabshipbroker.com) and base is configurable in Settings
// (default https://{cpanel_host}/mailman — the domain itself points at Vercel,
// so the Mailman UI is reached through the hosting server's own vhost).

import type { ListMember } from "./types";

export interface MailmanAuth {
  base: string;     // https://server353-4.web-hosting.com/mailman
  listEmail: string;
  password: string; // list admin password (Vault)
}

const listId = (listEmail: string) => listEmail.replace("@", "_");
const adminUrl = (a: MailmanAuth, page = "") =>
  `${a.base.replace(/\/$/, "")}/admin/${listId(a.listEmail)}${page ? `/${page}` : ""}`;

// Login once per operation: POST the admin password, keep the session cookie.
async function login(a: MailmanAuth): Promise<string> {
  let res: Response;
  try {
    res = await fetch(adminUrl(a), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ adminpw: a.password }),
      redirect: "manual",
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new Error(`Could not reach the Mailman admin at ${a.base}: ${e instanceof Error ? e.message : "network error"}`);
  }
  const cookie = res.headers.get("set-cookie");
  const m = cookie?.match(/([^\s=]+admin=[^;]+)/);
  if (!m) {
    const bodyText = await res.text().catch(() => "");
    if (/authorization|password/i.test(bodyText.slice(0, 4000)) || res.status === 401)
      throw new Error("Mailman rejected the list admin password — update it in the list's Manage panel.");
    throw new Error(`Mailman admin login gave no session (HTTP ${res.status}) — check the Mailman base URL in Settings.`);
  }
  return m[1];
}

async function adminGet(a: MailmanAuth, cookie: string, page: string): Promise<string> {
  const res = await fetch(adminUrl(a, page), {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Mailman page ${page} returned HTTP ${res.status}.`);
  return res.text();
}

// The membership page names its per-member inputs "{url-encoded email}_realname".
function parseMembersPage(html: string): ListMember[] {
  const out: ListMember[] = [];
  for (const m of html.matchAll(/name="([^"]+)_realname"[^>]*value="([^"]*)"/g)) {
    try {
      const email = decodeURIComponent(m[1]).toLowerCase();
      if (email.includes("@")) out.push({ email, name: m[2] ? m[2] : null });
    } catch { /* skip malformed */ }
  }
  return out;
}

// Long member lists paginate by letter and chunk — collect every page link.
function pageParams(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/members\?((?:letter=[^"&]*)?&?(?:chunk=\d+)?)"/g)) {
    if (m[1]) set.add(m[1]);
  }
  return [...set];
}

export async function mailmanListMembers(a: MailmanAuth): Promise<ListMember[]> {
  const cookie = await login(a);
  const first = await adminGet(a, cookie, "members");
  const seen = new Map<string, ListMember>();
  for (const mem of parseMembersPage(first)) seen.set(mem.email, mem);
  for (const qs of pageParams(first)) {
    const html = await adminGet(a, cookie, `members?${qs}`);
    for (const mem of parseMembersPage(html)) seen.set(mem.email, mem);
  }
  return [...seen.values()].sort((x, y) => x.email.localeCompare(y.email));
}

/** Mass-subscribe (no welcome mail, no owner notification). "Name <email>" entries allowed. */
export async function mailmanAddMembers(a: MailmanAuth, entries: string[]): Promise<void> {
  const res = await fetch(adminUrl(a, "members/add"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      subscribe_or_invite: "0",
      send_welcome_msg_to_this_batch: "0",
      send_notifications_to_list_owner: "0",
      subscribees: entries.join("\n"),
      adminpw: a.password,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  if (!res.ok || /authorization|adminpw/i.test(html.slice(0, 2000)) && /password/i.test(html.slice(0, 2000)))
    throw new Error("Mailman refused the subscription — check the list admin password.");
  const err = html.match(/Error subscribing:[\s\S]{0,400}?<li>([^<]+)/i);
  if (err && !/Successfully subscribed/i.test(html)) throw new Error(`Mailman: ${err[1].trim()}`);
}

export async function mailmanRemoveMembers(a: MailmanAuth, emails: string[]): Promise<void> {
  const res = await fetch(adminUrl(a, "members/remove"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      send_unsub_ack_to_this_batch: "0",
      send_unsub_notifications_to_list_owner: "0",
      unsubscribees: emails.join("\n"),
      adminpw: a.password,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  if (!res.ok) throw new Error(`Mailman remove returned HTTP ${res.status}.`);
  const err = html.match(/Cannot unsubscribe non-members:[\s\S]{0,400}?<li>([^<]+)/i);
  if (err && !/Successfully Unsubscribed/i.test(html)) throw new Error(`Mailman: not a member — ${err[1].trim()}`);
}
