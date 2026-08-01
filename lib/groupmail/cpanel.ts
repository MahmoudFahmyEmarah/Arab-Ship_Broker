// cPanel UAPI client for mailing-list management (server-only).
// Auth: cPanel API token — https://{host}:2083/execute/{Module}/{fn} with
// header "Authorization: cpanel {user}:{token}". The token is created once in
// cPanel → Security → Manage API Tokens and stored in Supabase Vault.

import type { MailingListRow } from "./types";

export interface CpanelAuth {
  host: string;  // server353-4.web-hosting.com
  user: string;  // cPanel account username
  token: string; // API token (Vault)
}

interface UapiEnvelope {
  status: number;
  data: unknown;
  errors: string[] | null;
  messages: string[] | null;
}

async function uapi(auth: CpanelAuth, fn: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `https://${auth.host}:2083/execute/Email/${fn}${qs.size ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `cpanel ${auth.user}:${auth.token}` },
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new Error(`Could not reach cPanel at ${auth.host}: ${e instanceof Error ? e.message : "network error"}`);
  }
  if (res.status === 401 || res.status === 403)
    throw new Error("cPanel rejected the credentials — check the username and API token in Settings.");
  if (!res.ok) throw new Error(`cPanel returned HTTP ${res.status}.`);
  const j = (await res.json()) as UapiEnvelope;
  if (!j.status) throw new Error(j.errors?.join("; ") || `cPanel Email::${fn} failed.`);
  return j.data;
}

export async function cpListLists(auth: CpanelAuth): Promise<MailingListRow[]> {
  const data = await uapi(auth, "list_lists");
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      list: String(rec.list ?? ""),
      listid: String(rec.listid ?? String(rec.list ?? "").replace("@", "_")),
      humanname: rec.humanname ? String(rec.humanname) : undefined,
      accesstype: rec.accesstype ? String(rec.accesstype) : undefined,
      diskused: rec.diskused ? String(rec.diskused) : undefined,
    };
  }).filter((r) => r.list);
}

export async function cpAddList(auth: CpanelAuth, local: string, domain: string, password: string, isPrivate: boolean): Promise<void> {
  await uapi(auth, "add_list", {
    list: local,
    domain,
    password,
    private: isPrivate ? 1 : 0,
  });
}

export async function cpDeleteList(auth: CpanelAuth, listEmail: string): Promise<void> {
  await uapi(auth, "delete_list", { list: listEmail });
}

/** Update a list's admin password and/or privacy (the two cPanel-side knobs). */
export async function cpUpdateList(
  auth: CpanelAuth,
  listEmail: string,
  opts: { password?: string; isPrivate?: boolean },
): Promise<void> {
  const [local, domain] = listEmail.split("@");
  const params: Record<string, string | number> = { list: listEmail, name: local, domain };
  if (opts.password) params.password = opts.password;
  if (opts.isPrivate !== undefined) params.private = opts.isPrivate ? 1 : 0;
  await uapi(auth, "update_list", params);
}
