// Group Mail — scheduled-send dispatcher core (server-only). Shared by the
// pg_cron-pinged API route (/api/group-mail/dispatch) and the admin's
// "Run scheduler now" action, so both paths behave identically.
//
// One tick processes ONE due campaign, in bounded chunks (serverless time
// limits): first tick resolves the member snapshot, every tick sends the next
// chunk, the final tick marks the campaign done. Failures on individual
// addresses are recorded and never stop the run; a campaign whose list can't
// be resolved is marked failed with the reason in `failures`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mailmanListMembers } from "./mailman";
import { buildCircularEmail, officeStamp, mailmanOptionsUrl } from "./template";
import { normalizeSignature } from "./types";
import { sendToRecipients, type SmtpAuth } from "./send";
import type { CampaignLink, Office } from "./types";

const CHUNK = 25; // sends per tick — safely inside a 60s function budget

interface DueCampaign {
  id: string;
  list_email: string;
  mode: "test" | "broadcast";
  subject: string;
  title: string | null;
  body: string;
  links: CampaignLink[] | null;
  badge: string | null;
  stamp_office: string | null;
  signature: unknown;
  recipients: string[] | null;
  sent_ok: number;
  sent_fail: number;
  failures: { email: string; error?: string }[] | null;
  status: string;
}

export interface DispatchResult {
  processed: string | null; // campaign id worked on this tick
  sent: number;
  failed: number;
  done: boolean;
  note: string;
}

async function secret(c: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await c.rpc("groupmail_get_secret", { p_key: key });
  return error ? null : ((data as string | null) ?? null);
}

/** Process one due scheduled campaign (or one chunk of it). */
export async function dispatchDue(c: SupabaseClient): Promise<DispatchResult> {
  const none: DispatchResult = { processed: null, sent: 0, failed: 0, done: false, note: "nothing due" };

  const { data: dueRows, error } = await c
    .from("groupmail_campaign")
    .select("id, list_email, mode, subject, title, body, links, badge, stamp_office, signature, recipients, sent_ok, sent_fail, failures, status")
    .in("status", ["scheduled", "sending"])
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1);
  if (error || !dueRows?.length) return none;
  const camp = dueRows[0] as DueCampaign;

  const fail = async (why: string): Promise<DispatchResult> => {
    await c.from("groupmail_campaign").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      failures: [...(camp.failures ?? []), { email: "(dispatch)", error: why }],
    }).eq("id", camp.id);
    return { processed: camp.id, sent: 0, failed: 0, done: true, note: `failed: ${why}` };
  };

  // config + SMTP credentials
  const { data: cfg } = await c.from("groupmail_config").select("*").eq("id", 1).maybeSingle();
  if (!cfg?.smtp_host || !cfg?.smtp_user) return fail("SMTP is not configured");
  const smtpPass = await secret(c, "smtp_password");
  if (!smtpPass) return fail("SMTP password missing from Vault");
  const smtp: SmtpAuth = {
    host: cfg.smtp_host, port: cfg.smtp_port || 465, user: cfg.smtp_user,
    password: smtpPass, fromName: cfg.from_name ?? "Arab ShipBroker",
  };

  // first tick: resolve + freeze the recipient list
  let recipients = camp.recipients;
  if (!recipients) {
    if (camp.mode === "test") {
      recipients = (cfg.test_recipients ?? []) as string[];
      if (!recipients.length) return fail("no test recipients configured");
    } else {
      const listPw = await secret(c, `list:${camp.list_email}`);
      if (!listPw) return fail("list admin password missing from Vault");
      const base = cfg.mailman_base?.trim() || (cfg.cpanel_host ? `https://${cfg.cpanel_host}/mailman` : null);
      if (!base) return fail("Mailman base URL not configured");
      try {
        const members = await mailmanListMembers({ base, listEmail: camp.list_email, password: listPw });
        recipients = members.map((m) => m.email);
      } catch (e) {
        return fail(e instanceof Error ? e.message : "could not read the member list");
      }
      if (!recipients.length) return fail("the list has no members");
    }
    await c.from("groupmail_campaign").update({
      recipients, recipients_total: recipients.length, status: "sending",
    }).eq("id", camp.id);
  }

  // send the next chunk
  const offset = camp.sent_ok + camp.sent_fail;
  const chunk = recipients.slice(offset, offset + CHUNK);
  if (chunk.length === 0) {
    await c.from("groupmail_campaign").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", camp.id);
    return { processed: camp.id, sent: 0, failed: 0, done: true, note: "completed" };
  }

  const mailmanBase = cfg.mailman_base?.trim() || (cfg.cpanel_host ? `https://${cfg.cpanel_host}/mailman` : null);
  const unsubscribeUrl = camp.mode === "broadcast" ? mailmanOptionsUrl(mailmanBase, camp.list_email) : null;
  const mail = buildCircularEmail(
    {
      list_email: camp.list_email, subject: camp.subject, title: camp.title ?? "",
      body: camp.body, links: camp.links ?? [], badge: camp.badge ?? "Circulation",
      office: (camp.stamp_office as Office) ?? "Cairo",
      signature: normalizeSignature(camp.signature ?? cfg.signature, cfg.smtp_user),
    },
    officeStamp(((camp.stamp_office as Office) ?? "Cairo")),
    undefined,
    cfg.smtp_user,
    unsubscribeUrl,
  );
  const results = await sendToRecipients(smtp, chunk, { ...mail, replyTo: cfg.smtp_user, listEmail: camp.list_email, unsubscribeUrl });
  const ok = results.filter((r) => r.ok).length;
  const failures = results.filter((r) => !r.ok).map((r) => ({ email: r.email, error: r.error }));
  const finished = offset + chunk.length >= recipients.length;
  await c.from("groupmail_campaign").update({
    sent_ok: camp.sent_ok + ok,
    sent_fail: camp.sent_fail + failures.length,
    failures: [...(camp.failures ?? []), ...failures],
    ...(finished ? { status: "done", finished_at: new Date().toISOString() } : {}),
  }).eq("id", camp.id);

  return { processed: camp.id, sent: ok, failed: failures.length, done: finished, note: finished ? "completed" : `chunk sent (${offset + chunk.length}/${recipients.length})` };
}
