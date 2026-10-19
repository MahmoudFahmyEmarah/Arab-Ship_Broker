// One port-search rule for every form that asks for a port (owner request, 19 Oct 2026): a member or admin
// types part of a name, a UN/LOCODE or a country, picks a row, and the form stores the LOCODE — never a
// hand-typed code. Pure (no I/O), so scripts/port-search-check.ts tests it directly; each form supplies the
// list it may offer (verified ports, a supplier's registered ports, every active port for an admin, …).

export interface PortChoice {
  locode: string;
  name: string;
  country?: string | null;
  zone?: string | null;
  /** a short marker shown with the row, e.g. "tariff published" */
  note?: string | null;
}

/** Lower-case, accents removed, punctuation folded to spaces — "Constanța" matches "constanta". */
export function foldPortText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** UN/LOCODE without spaces, upper-case ("EG ALY" → "EGALY"). */
export function normLocode(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Ranks matches for a query: exact LOCODE, LOCODE prefix, name prefix, a word of the name starting with the
 * query, name contains, country contains. An empty query returns the first `limit` options as given.
 */
export function filterPorts(options: readonly PortChoice[], query: string, limit = 12): PortChoice[] {
  const q = foldPortText(query);
  if (!q) return options.slice(0, limit);
  const qCode = normLocode(query);
  const scored: { p: PortChoice; score: number; i: number }[] = [];
  options.forEach((p, i) => {
    const code = normLocode(p.locode);
    const name = foldPortText(p.name);
    const country = foldPortText(p.country);
    let score = 0;
    if (code === qCode) score = 100;
    else if (qCode.length >= 2 && code.startsWith(qCode)) score = 80;
    else if (name.startsWith(q)) score = 70;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 60;
    else if (name.includes(q)) score = 50;
    else if (country && country.startsWith(q)) score = 30;
    else if (country && country.includes(q)) score = 20;
    if (score > 0) scored.push({ p, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name) || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.p);
}

/** The option a stored LOCODE refers to, if it is in the list. */
export function findPort(options: readonly PortChoice[], locode: string | null | undefined): PortChoice | null {
  const c = normLocode(locode);
  if (!c) return null;
  return options.find((p) => normLocode(p.locode) === c) ?? null;
}

/**
 * For free text that may name a port (Data Sync review): the single option whose name or LOCODE matches the
 * text exactly (accents/case ignored), else null. Never guesses between several candidates.
 */
export function exactPortMatch(options: readonly PortChoice[], text: string | null | undefined): PortChoice | null {
  const t = foldPortText(text);
  if (!t) return null;
  const byCode = options.filter((p) => normLocode(p.locode) === normLocode(text));
  if (byCode.length === 1) return byCode[0];
  const byName = options.filter((p) => foldPortText(p.name) === t);
  return byName.length === 1 ? byName[0] : null;
}

/** "Alexandria · Egypt · EGALY" */
export function portLabel(p: PortChoice): string {
  return [p.name, p.country, normLocode(p.locode)].filter(Boolean).join(" · ");
}
