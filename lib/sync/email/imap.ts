// Fetch circulation emails over IMAP (Namecheap Private Email, Gmail, or any
// IMAP host). Node-only (imapflow). Password comes from Vault via the caller;
// it is never logged.

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailMsg } from "./types";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  folder: string;
  query?: string | null;
}

export interface FetchOpts {
  limit?: number;
  since?: Date;            // fetch only mail newer than this instant (the watermark)
  onLog?: (msg: string) => void;
}

export async function fetchCirculars(
  cfg: ImapConfig,
  password: string,
  opts: FetchOpts = {},
): Promise<EmailMsg[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  // Default window if no watermark yet: last 7 days.
  const since = opts.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // IMAP SINCE is date-granular, so search from the start of the watermark's day,
  // then filter by the precise timestamp below to get hour/minute precision.
  const searchSince = new Date(since);
  searchSince.setHours(0, 0, 0, 0);
  const log = opts.onLog ?? (() => {});

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: password },
    logger: false,
    // fail fast rather than hang the SSE stream on a bad host/credential
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  });

  const out: EmailMsg[] = [];
  await client.connect();
  log(`connected to ${cfg.host} as ${cfg.user}`);

  const lock = await client.getMailboxLock(cfg.folder || "INBOX");
  try {
    // Optional server-side filter from the configured search query:
    //   "from:acme.com" → sender contains · "subject:wheat" → subject contains
    //   anything else → full-text search. ANDed with the date window.
    const q = (cfg.query ?? "").trim();
    const filter = q
      ? /^from:/i.test(q) ? { from: q.slice(5).trim() }
        : /^subject:/i.test(q) ? { subject: q.slice(8).trim() }
        : { text: q }
      : {};
    if (q) log(`filtering by ${q}`);
    const uids = (await client.search({ since: searchSince, ...filter }, { uid: true })) || [];
    if (uids.length === 0) { log(`no messages since ${since.toISOString()}`); return out; }

    // Cheap envelope pass: get each message's true datetime, keep only those
    // strictly newer than the watermark, then take the most recent `limit`.
    const metas: { uid: number; when: Date }[] = [];
    for await (const m of client.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
      const when = (m.internalDate as Date | undefined) ?? m.envelope?.date ?? null;
      if (when && when.getTime() > since.getTime()) metas.push({ uid: m.uid as number, when });
    }
    metas.sort((a, b) => a.when.getTime() - b.when.getTime());
    const pick = metas.slice(-limit).map((m) => m.uid);
    log(`${pick.length} new message(s) since ${since.toISOString().slice(0, 16).replace("T", " ")} UTC`);
    if (pick.length === 0) return out;

    for await (const msg of client.fetch(pick, { source: true }, { uid: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const text = (parsed.text ?? parsed.html ?? "").toString();
      out.push({
        id: String(msg.uid),
        from: parsed.from?.text ?? "",
        subject: parsed.subject ?? "(no subject)",
        date: parsed.date ? parsed.date.toISOString() : null,
        text,
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
