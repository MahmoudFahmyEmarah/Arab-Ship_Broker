"use server";

// Group Mail server actions. Every call is gated by requireAdmin({ section:
// "groupmail", edit: true }) (owner-only section) and runs on the service-role
// client. Secrets (cPanel token, SMTP password, per-list admin passwords) live
// in Supabase Vault via the groupmail_* RPCs and never reach the browser.

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { cpListLists, cpAddList, cpDeleteList, cpUpdateList, type CpanelAuth } from "@/lib/groupmail/cpanel";
import { mailmanListMembers, mailmanAddMembers, mailmanRemoveMembers, type MailmanAuth } from "@/lib/groupmail/mailman";
import { buildCircularEmail } from "@/lib/groupmail/template";
import { sendToRecipients, verifySmtp, type SmtpAuth } from "@/lib/groupmail/send";
import type {
  GroupMailConfig, GroupMailSecretStatus, MailingListRow, ListMember,
  CampaignInput, CampaignRow,
} from "@/lib/groupmail/types";

type Result<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BATCH = 10;

async function adminWrite() {
  const u = await requireAdmin({ section: "groupmail", edit: true });
  return { c: getSupabaseAdminClient(), actor: u.rowId };
}

function fail(e: unknown, fallback: string): { success: false; error: string } {
  return { success: false, error: e instanceof Error ? e.message : fallback };
}

// ── config + secrets ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GroupMailConfig = {
  cpanel_host: null, cpanel_user: null, mailman_base: null,
  smtp_host: null, smtp_port: 465, smtp_user: null,
  from_name: "Arab ShipBroker", test_recipients: null,
};

async function readConfig(c: ReturnType<typeof getSupabaseAdminClient>): Promise<GroupMailConfig> {
  const { data } = await c.from("groupmail_config").select("*").eq("id", 1).maybeSingle();
  return data ? { ...DEFAULT_CONFIG, ...data } : DEFAULT_CONFIG;
}

async function readSecret(c: ReturnType<typeof getSupabaseAdminClient>, key: string): Promise<string | null> {
  const { data, error } = await c.rpc("groupmail_get_secret", { p_key: key });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function getGroupMailState(): Promise<Result<{ config: GroupMailConfig; secrets: GroupMailSecretStatus }>> {
  try {
    const { c } = await adminWrite();
    const config = await readConfig(c);
    const { data: secretRows } = await c.from("groupmail_secret").select("key");
    const keys = new Set((secretRows ?? []).map((r) => (r as { key: string }).key));
    return {
      success: true,
      data: {
        config,
        secrets: {
          cpanel_token: keys.has("cpanel_token"),
          smtp_password: keys.has("smtp_password"),
          lists: [...keys].filter((k) => k.startsWith("list:")).map((k) => k.slice(5)),
        },
      },
    };
  } catch (e) {
    return fail(e, "Could not load settings.");
  }
}

export async function saveGroupMailConfig(patch: Partial<GroupMailConfig>): Promise<Result> {
  try {
    const { c } = await adminWrite();
    const allowed: (keyof GroupMailConfig)[] = [
      "cpanel_host", "cpanel_user", "mailman_base", "smtp_host", "smtp_port", "smtp_user", "from_name", "test_recipients",
    ];
    const clean: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
    const { error } = await c.from("groupmail_config").upsert(clean, { onConflict: "id" });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save settings.");
  }
}

export async function saveGroupMailSecret(key: "cpanel_token" | "smtp_password", value: string): Promise<Result> {
  if (!value.trim()) return { success: false, error: "Enter a value to save." };
  try {
    const { c } = await adminWrite();
    const { error } = await c.rpc("groupmail_set_secret", { p_key: key, p_value: value.trim() });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return fail(e, "Could not store the secret.");
  }
}

// ── connection tests ────────────────────────────────────────────────────────

async function cpanelAuth(c: ReturnType<typeof getSupabaseAdminClient>): Promise<CpanelAuth> {
  const cfg = await readConfig(c);
  if (!cfg.cpanel_host || !cfg.cpanel_user)
    throw new Error("Set the cPanel host and username in Settings first.");
  const token = await readSecret(c, "cpanel_token");
  if (!token) throw new Error("Save the cPanel API token in Settings first.");
  return { host: cfg.cpanel_host, user: cfg.cpanel_user, token };
}

async function smtpAuth(c: ReturnType<typeof getSupabaseAdminClient>): Promise<SmtpAuth> {
  const cfg = await readConfig(c);
  if (!cfg.smtp_host || !cfg.smtp_user)
    throw new Error("Set the SMTP host and mailbox in Settings first.");
  const password = await readSecret(c, "smtp_password");
  if (!password) throw new Error("Save the SMTP mailbox password in Settings first.");
  return { host: cfg.smtp_host, port: cfg.smtp_port || 465, user: cfg.smtp_user, password, fromName: cfg.from_name };
}

export async function testCpanelConnection(): Promise<Result<{ lists: number }>> {
  try {
    const { c } = await adminWrite();
    const lists = await cpListLists(await cpanelAuth(c));
    return { success: true, data: { lists: lists.length } };
  } catch (e) {
    return fail(e, "cPanel connection failed.");
  }
}

export async function testSmtpConnection(): Promise<Result> {
  try {
    const { c } = await adminWrite();
    await verifySmtp(await smtpAuth(c));
    return { success: true };
  } catch (e) {
    return fail(e, "SMTP connection failed.");
  }
}

// ── mailing lists (cPanel) ──────────────────────────────────────────────────

export async function listMailingLists(): Promise<Result<MailingListRow[]>> {
  try {
    const { c } = await adminWrite();
    return { success: true, data: await cpListLists(await cpanelAuth(c)) };
  } catch (e) {
    return fail(e, "Could not read the mailing lists.");
  }
}

export async function createMailingList(
  local: string, domain: string, password: string, isPrivate: boolean,
): Promise<Result> {
  const name = local.trim().toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(name)) return { success: false, error: "List name may only contain letters, digits, dots, dashes." };
  if (!domain.trim()) return { success: false, error: "Domain is required." };
  if (password.length < 8) return { success: false, error: "Admin password must be at least 8 characters." };
  try {
    const { c } = await adminWrite();
    await cpAddList(await cpanelAuth(c), name, domain.trim(), password, isPrivate);
    // remember the admin password so member management works immediately
    await c.rpc("groupmail_set_secret", { p_key: `list:${name}@${domain.trim()}`, p_value: password });
    return { success: true };
  } catch (e) {
    return fail(e, "Could not create the list.");
  }
}

export async function deleteMailingList(listEmail: string): Promise<Result> {
  if (!EMAIL_RE.test(listEmail)) return { success: false, error: "Invalid list address." };
  try {
    const { c } = await adminWrite();
    await cpDeleteList(await cpanelAuth(c), listEmail);
    await c.rpc("groupmail_delete_secret", { p_key: `list:${listEmail}` });
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete the list.");
  }
}

export async function updateMailingList(
  listEmail: string, opts: { password?: string; isPrivate?: boolean },
): Promise<Result> {
  if (!EMAIL_RE.test(listEmail)) return { success: false, error: "Invalid list address." };
  if (opts.password !== undefined && opts.password.length < 8)
    return { success: false, error: "Admin password must be at least 8 characters." };
  try {
    const { c } = await adminWrite();
    await cpUpdateList(await cpanelAuth(c), listEmail, opts);
    if (opts.password) await c.rpc("groupmail_set_secret", { p_key: `list:${listEmail}`, p_value: opts.password });
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the list.");
  }
}

/** Store the admin password for a list created outside the app (no cPanel change). */
export async function saveListPassword(listEmail: string, password: string): Promise<Result> {
  if (!EMAIL_RE.test(listEmail)) return { success: false, error: "Invalid list address." };
  if (!password.trim()) return { success: false, error: "Enter the list admin password." };
  try {
    const { c } = await adminWrite();
    const { error } = await c.rpc("groupmail_set_secret", { p_key: `list:${listEmail}`, p_value: password.trim() });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return fail(e, "Could not store the password.");
  }
}

// ── members (Mailman admin) ─────────────────────────────────────────────────

async function mailmanAuth(c: ReturnType<typeof getSupabaseAdminClient>, listEmail: string): Promise<MailmanAuth> {
  const cfg = await readConfig(c);
  const base = cfg.mailman_base?.trim() ||
    (cfg.cpanel_host ? `https://${cfg.cpanel_host}/mailman` : null);
  if (!base) throw new Error("Set the Mailman base URL (or cPanel host) in Settings first.");
  const password = await readSecret(c, `list:${listEmail}`);
  if (!password)
    throw new Error("No admin password saved for this list — enter it in the Manage panel first.");
  return { base, listEmail, password };
}

export async function getListMembers(listEmail: string): Promise<Result<ListMember[]>> {
  if (!EMAIL_RE.test(listEmail)) return { success: false, error: "Invalid list address." };
  try {
    const { c } = await adminWrite();
    return { success: true, data: await mailmanListMembers(await mailmanAuth(c, listEmail)) };
  } catch (e) {
    return fail(e, "Could not read the member list.");
  }
}

export async function addListMembers(listEmail: string, entries: string[]): Promise<Result<{ added: number }>> {
  const clean = entries.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return { success: false, error: "Enter at least one email address." };
  if (clean.length > 200) return { success: false, error: "Add at most 200 addresses at a time." };
  const bad = clean.find((s) => !EMAIL_RE.test(s.match(/<([^>]+)>/)?.[1] ?? s));
  if (bad) return { success: false, error: `"${bad}" is not a valid address (use email or "Name <email>").` };
  try {
    const { c } = await adminWrite();
    await mailmanAddMembers(await mailmanAuth(c, listEmail), clean);
    return { success: true, data: { added: clean.length } };
  } catch (e) {
    return fail(e, "Could not add the members.");
  }
}

export async function removeListMembers(listEmail: string, emails: string[]): Promise<Result<{ removed: number }>> {
  const clean = emails.map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s));
  if (clean.length === 0) return { success: false, error: "Nothing to remove." };
  try {
    const { c } = await adminWrite();
    await mailmanRemoveMembers(await mailmanAuth(c, listEmail), clean);
    return { success: true, data: { removed: clean.length } };
  } catch (e) {
    return fail(e, "Could not remove the members.");
  }
}

/** Edit = remove the old address, subscribe the new one (keeps the name). */
export async function replaceListMember(
  listEmail: string, oldEmail: string, newEntry: string,
): Promise<Result> {
  const next = newEntry.trim();
  if (!EMAIL_RE.test(next.match(/<([^>]+)>/)?.[1] ?? next))
    return { success: false, error: "The new address is not valid." };
  try {
    const { c } = await adminWrite();
    const auth = await mailmanAuth(c, listEmail);
    await mailmanAddMembers(auth, [next]);
    if (oldEmail.trim().toLowerCase() !== (next.match(/<([^>]+)>/)?.[1] ?? next).toLowerCase())
      await mailmanRemoveMembers(auth, [oldEmail.trim().toLowerCase()]);
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the member.");
  }
}

// ── compose · preview · send ────────────────────────────────────────────────

function stamp(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Africa/Cairo", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " (Cairo)";
}

function validCampaign(input: CampaignInput): string | null {
  if (!input.subject.trim()) return "Subject is required.";
  if (!input.body.trim()) return "Write the body of the mail.";
  if (!EMAIL_RE.test(input.list_email)) return "Pick a mailing list.";
  const badLink = input.links.find((l) => (l.label.trim() || l.url.trim()) && !/^https?:\/\//i.test(l.url.trim()));
  if (badLink) return `Link "${badLink.label || badLink.url}" needs a full http(s) URL.`;
  return null;
}

export async function previewCircular(input: CampaignInput): Promise<Result<{ html: string; subject: string }>> {
  const bad = validCampaign(input);
  if (bad) return { success: false, error: bad };
  try {
    await adminWrite();
    const { html, subject } = buildCircularEmail(input, stamp());
    return { success: true, data: { html, subject } };
  } catch (e) {
    return fail(e, "Could not build the preview.");
  }
}

/**
 * Create the campaign record and resolve its recipients.
 * test → the provided test addresses; broadcast → the live Mailman roster.
 * Actual sending happens in batches via sendCircularBatch (keeps every server
 * call short, shows real progress, and survives serverless time limits).
 */
export async function startCircular(
  input: CampaignInput, mode: "test" | "broadcast", testRecipients?: string[],
): Promise<Result<{ campaignId: string; recipients: string[] }>> {
  const bad = validCampaign(input);
  if (bad) return { success: false, error: bad };
  try {
    const { c, actor } = await adminWrite();
    let recipients: string[];
    if (mode === "test") {
      recipients = (testRecipients ?? []).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s));
      if (recipients.length === 0) return { success: false, error: "Enter at least one valid test address." };
      if (recipients.length > 10) return { success: false, error: "Test sends are capped at 10 addresses." };
    } else {
      const members = await mailmanListMembers(await mailmanAuth(c, input.list_email));
      recipients = members.map((m) => m.email);
      if (recipients.length === 0) return { success: false, error: "The list has no members." };
    }
    await smtpAuth(c); // fail fast if SMTP is not configured
    const { data, error } = await c
      .from("groupmail_campaign")
      .insert({
        list_email: input.list_email, mode, subject: input.subject.trim(),
        title: input.title.trim() || null, body: input.body, links: input.links.filter((l) => l.label && l.url),
        badge: input.badge.trim() || "Circulation",
        recipients_total: recipients.length, sent_by: actor,
      })
      .select("id")
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: { campaignId: (data as { id: string }).id, recipients } };
  } catch (e) {
    return fail(e, "Could not start the send.");
  }
}

export async function sendCircularBatch(
  campaignId: string, emails: string[],
): Promise<Result<{ ok: number; fail: number; failures: { email: string; error?: string }[] }>> {
  if (!Array.isArray(emails) || emails.length === 0) return { success: false, error: "Empty batch." };
  if (emails.length > MAX_BATCH) return { success: false, error: `Batches are capped at ${MAX_BATCH}.` };
  try {
    const { c } = await adminWrite();
    const { data: camp, error: cErr } = await c
      .from("groupmail_campaign")
      .select("id, list_email, subject, title, body, links, badge, sent_ok, sent_fail, failures, status")
      .eq("id", campaignId)
      .single();
    if (cErr || !camp) return { success: false, error: "Campaign not found." };
    const row = camp as {
      list_email: string; subject: string; title: string | null; body: string;
      links: { label: string; url: string }[] | null; badge: string | null;
      sent_ok: number; sent_fail: number; failures: { email: string; error?: string }[] | null; status: string;
    };
    if (row.status !== "sending") return { success: false, error: "This campaign is already finished." };
    const mail = buildCircularEmail(
      {
        list_email: row.list_email, subject: row.subject, title: row.title ?? "",
        body: row.body, links: row.links ?? [], badge: row.badge ?? "Circulation",
      },
      stamp(),
    );
    const results = await sendToRecipients(await smtpAuth(c), emails, mail);
    const ok = results.filter((r) => r.ok).length;
    const failures = results.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error }));
    await c.from("groupmail_campaign").update({
      sent_ok: row.sent_ok + ok,
      sent_fail: row.sent_fail + failures.length,
      failures: [...(row.failures ?? []), ...failures],
    }).eq("id", campaignId);
    return { success: true, data: { ok, fail: failures.length, failures } };
  } catch (e) {
    return fail(e, "Batch send failed.");
  }
}

export async function finishCircular(campaignId: string): Promise<Result<CampaignRow>> {
  try {
    const { c } = await adminWrite();
    const { data, error } = await c
      .from("groupmail_campaign")
      .update({ status: "done", finished_at: new Date().toISOString() })
      .eq("id", campaignId)
      .select("id, list_email, mode, subject, recipients_total, sent_ok, sent_fail, status, created_at, finished_at")
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: data as CampaignRow };
  } catch (e) {
    return fail(e, "Could not finalise the campaign.");
  }
}

export async function listCircularHistory(limit = 20): Promise<Result<CampaignRow[]>> {
  try {
    const { c } = await adminWrite();
    const { data, error } = await c
      .from("groupmail_campaign")
      .select("id, list_email, mode, subject, recipients_total, sent_ok, sent_fail, status, created_at, finished_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as CampaignRow[] };
  } catch (e) {
    return fail(e, "Could not read the history.");
  }
}
