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
  /** IMAP checkpoint (phase 1): when the folder's UIDVALIDITY matches, read UIDs above lastUid instead of the date window */
  uidValidity?: number | null;
  lastUid?: number | null;
  onLog?: (msg: string) => void;
}

export interface FetchResult {
  messages: EmailMsg[];
  /** INTERNALDATE of the newest message in this page — the next checkpoint when hasMore */
  newestAt: Date | null;
  /** newer mail than this page exists; the caller must not jump the checkpoint past it */
  hasMore: boolean;
  /** "uid" when the page was read from the UID checkpoint, "date" from the time window */
  mode: "uid" | "date";
  /** the folder's UIDVALIDITY, and the highest UID in this page */
  uidValidity: number | null;
  lastUid: number | null;
  /** how many messages were waiting in total (page + rest) */
  waiting: number;
}

/** UID-mode page: the lowest UIDs first, exactly `limit` of them. */
export function pickUidPage<T extends { uid: number }>(metas: T[], limit: number): { page: T[]; hasMore: boolean; lastUid: number | null } {
  const sorted = [...metas].sort((a, b) => a.uid - b.uid);
  const page = sorted.slice(0, limit);
  return { page, hasMore: sorted.length > page.length, lastUid: page.length ? page[page.length - 1].uid : null };
}

/**
 * Which messages to take from the newer-than-checkpoint set (phase 0, 18 Sep
 * 2026). OLDEST first, so a backlog larger than the page is worked through
 * run after run instead of the newest page being taken and the rest skipped
 * for good. The page stretches to include every message that shares the
 * cutoff second: INTERNALDATE is second-granular and the checkpoint moves to
 * that instant, so a message in the same second must not be left behind.
 */
export function pickPage<T extends { uid: number; when: Date }>(metas: T[], limit: number): { page: T[]; newestAt: Date | null; hasMore: boolean } {
  const sorted = [...metas].sort((a, b) => a.when.getTime() - b.when.getTime() || a.uid - b.uid);
  if (sorted.length <= limit) return { page: sorted, newestAt: sorted.length ? sorted[sorted.length - 1].when : null, hasMore: false };
  let end = limit;
  const cutoff = Math.floor(sorted[limit - 1].when.getTime() / 1000);
  while (end < sorted.length && Math.floor(sorted[end].when.getTime() / 1000) === cutoff) end += 1;
  const page = sorted.slice(0, end);
  return { page, newestAt: page[page.length - 1].when, hasMore: end < sorted.length };
}

export async function fetchCirculars(
  cfg: ImapConfig,
  password: string,
  opts: FetchOpts = {},
): Promise<FetchResult> {
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

  const out: FetchResult = { messages: [], newestAt: null, hasMore: false, mode: "date", uidValidity: null, lastUid: null, waiting: 0 };
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

    // The folder's UIDVALIDITY: while it matches the stored checkpoint, every
    // message with a UID above last_uid is still unread by the sync — no
    // clock involved, nothing can fall between two runs. A different value
    // (folder rebuilt, server migrated) falls back to the time window once.
    const mb = client.mailbox;
    const folderValidity = mb && typeof mb === "object" && mb.uidValidity != null ? Number(mb.uidValidity) : null;
    out.uidValidity = Number.isFinite(folderValidity) ? folderValidity : null;
    const uidMode = opts.lastUid != null && opts.uidValidity != null && out.uidValidity != null && opts.uidValidity === out.uidValidity;

    const metas: { uid: number; when: Date }[] = [];
    let page: { uid: number; when: Date }[];
    if (uidMode) {
      out.mode = "uid";
      const from = (opts.lastUid as number) + 1;
      // `n:*` also returns the highest-UID message when n is past the end — filter it
      const uids = ((await client.search({ uid: `${from}:*`, ...filter }, { uid: true })) || []).filter((u) => u >= from);
      if (uids.length === 0) { log(`no messages above UID ${opts.lastUid} (UIDVALIDITY ${out.uidValidity})`); return out; }
      for await (const m of client.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
        const when = (m.internalDate as Date | undefined) ?? m.envelope?.date ?? new Date();
        metas.push({ uid: m.uid as number, when });
      }
      const pick = pickUidPage(metas, limit);
      page = pick.page; out.hasMore = pick.hasMore; out.lastUid = pick.lastUid;
      out.newestAt = page.length ? new Date(Math.max(...page.map((m) => m.when.getTime()))) : null;
      log(`${page.length} of ${metas.length} message(s) above UID ${opts.lastUid}${pick.hasMore ? ` — ${metas.length - page.length} more wait for the next page` : ""}`);
    } else {
      out.mode = "date";
      if (opts.lastUid != null && opts.uidValidity != null && out.uidValidity !== opts.uidValidity) log(`folder UIDVALIDITY changed (${opts.uidValidity} → ${out.uidValidity}) — reading by date once, then the UID checkpoint restarts`);
      const uids = (await client.search({ since: searchSince, ...filter }, { uid: true })) || [];
      if (uids.length === 0) { log(`no messages since ${since.toISOString()}`); return out; }
      // Cheap envelope pass: get each message's true datetime, keep only those
      // strictly newer than the watermark, then take the OLDEST `limit`.
      for await (const m of client.fetch(uids, { envelope: true, internalDate: true }, { uid: true })) {
        const when = (m.internalDate as Date | undefined) ?? m.envelope?.date ?? null;
        if (when && when.getTime() > since.getTime()) metas.push({ uid: m.uid as number, when });
      }
      const pick = pickPage(metas, limit);
      page = pick.page; out.newestAt = pick.newestAt; out.hasMore = pick.hasMore;
      out.lastUid = page.length ? Math.max(...page.map((m) => m.uid)) : null;
      log(`${page.length} of ${metas.length} new message(s) since ${since.toISOString().slice(0, 16).replace("T", " ")} UTC${pick.hasMore ? ` — ${metas.length - page.length} more wait for the next page` : ""}`);
    }
    out.waiting = metas.length;
    const whenByUid = new Map(page.map((m) => [m.uid, m.when]));
    if (page.length === 0) return out;

    for await (const msg of client.fetch(page.map((m) => m.uid), { source: true }, { uid: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const text = (parsed.text ?? parsed.html ?? "").toString();
      out.messages.push({
        id: String(msg.uid),
        from: parsed.from?.text ?? "",
        subject: parsed.subject ?? "(no subject)",
        date: parsed.date ? parsed.date.toISOString() : null,
        receivedAt: whenByUid.get(msg.uid as number)?.toISOString() ?? null,
        text,
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}
