// One canonical flag-state resolver for PDA flag treatment (Codex C2O-090 B2C-035 P1-1, C2O-094). The registry is
// public.flag_states (ship registers: name is the primary key; iso2 and aliases are not unique). A flag resolves to
// an ISO 3166-1 alpha-2 code only when the answer is unambiguous; anything else is unknown (null), so a rule that
// needs the treatment raises MISSING_INPUT instead of pricing the vessel as foreign by default.
//
// The resolver receives the WHOLE registry (active and inactive rows): an exact canonical name decides on its own
// — it resolves only when every row carrying that name is active with a valid ISO code, otherwise the flag is
// unknown — and aliases are consulted only when no row has that canonical name at all.

export interface FlagStateRow {
  name: string | null;
  iso2: string | null;
  aliases?: string[] | null;
  is_active?: boolean | null;
}

const ISO2 = /^[A-Z]{2}$/;
const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
const isoOf = (row: FlagStateRow) => (row.iso2 ?? "").trim().toUpperCase();
/** Active with a well-formed ISO code. Absent `is_active` is read as inactive: the registry query must select it. */
const usable = (row: FlagStateRow) => row.is_active === true && ISO2.test(isoOf(row));

/** One ISO code from rows that must all be usable; anything inactive, malformed or conflicting → null. */
function decide(rows: FlagStateRow[]): string | null {
  if (!rows.length || !rows.every(usable)) return null;
  const distinct = [...new Set(rows.map(isoOf))];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * A registered flag NAME (as stored on vessels.flag) → ISO2. An exact canonical name decides alone (never falls
 * through to another register's alias); aliases count only when no canonical row exists, and only when every
 * matching row is active, valid and points to one ISO code. Unknown, inactive, malformed or ambiguous → null.
 */
export function resolveFlagName(rows: readonly FlagStateRow[] | null | undefined, flag: string | null | undefined): string | null {
  const wanted = norm(flag);
  if (!wanted || wanted === "—" || !rows) return null;
  const canonical = rows.filter((row) => norm(row.name) === wanted);
  if (canonical.length) return decide(canonical);
  return decide(rows.filter((row) => (row.aliases ?? []).some((alias) => norm(alias) === wanted)));
}

/** A DECLARED ISO2 (standalone estimate, unowned vessel) counts only if an active, valid register carries that code. */
export function resolveDeclaredFlag(rows: readonly FlagStateRow[] | null | undefined, iso: string | null | undefined): string | null {
  const wanted = (iso ?? "").trim().toUpperCase();
  if (!ISO2.test(wanted) || !rows) return null;
  return rows.some((row) => usable(row) && isoOf(row) === wanted) ? wanted : null;
}
