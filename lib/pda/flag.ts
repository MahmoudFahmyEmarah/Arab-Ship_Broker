// One canonical flag-state resolver for PDA flag treatment (Codex C2O-090 B2C-035 P1-1). The registry is
// public.flag_states (ship registers: name is the primary key; iso2 and aliases are not unique). A flag resolves to
// an ISO 3166-1 alpha-2 code only when the answer is unambiguous; anything else is unknown (null), so a rule that
// needs the treatment raises MISSING_INPUT instead of pricing the vessel as foreign by default.

export interface FlagStateRow {
  name: string | null;
  iso2: string | null;
  aliases?: string[] | null;
  is_active?: boolean | null;
}

const ISO2 = /^[A-Z]{2}$/;
const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/** Active rows with a well-formed ISO code; malformed or inactive rows never resolve anything. */
function usable(rows: readonly FlagStateRow[]): { name: string; iso2: string; aliases: string[] }[] {
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => ({ name: norm(row.name), iso2: (row.iso2 ?? "").trim().toUpperCase(), aliases: (row.aliases ?? []).map(norm) }))
    .filter((row) => row.name && ISO2.test(row.iso2));
}

function single(isos: string[]): string | null {
  const distinct = [...new Set(isos)];
  return distinct.length === 1 ? distinct[0] : null;
}

/**
 * A registered flag NAME (as stored on vessels.flag) → ISO2. An exact canonical-name match wins; otherwise an
 * alias match counts only when every matching alias points to one ISO code. Unknown or ambiguous → null.
 */
export function resolveFlagName(rows: readonly FlagStateRow[] | null | undefined, flag: string | null | undefined): string | null {
  const wanted = norm(flag);
  if (!wanted || wanted === "—" || !rows) return null;
  const registry = usable(rows);
  const canonical = registry.filter((row) => row.name === wanted);
  if (canonical.length) return single(canonical.map((row) => row.iso2));
  return single(registry.filter((row) => row.aliases.includes(wanted)).map((row) => row.iso2));
}

/** A DECLARED ISO2 (standalone estimate, unowned vessel) counts only if an active register carries that code. */
export function resolveDeclaredFlag(rows: readonly FlagStateRow[] | null | undefined, iso: string | null | undefined): string | null {
  const wanted = (iso ?? "").trim().toUpperCase();
  if (!ISO2.test(wanted) || !rows) return null;
  return usable(rows).some((row) => row.iso2 === wanted) ? wanted : null;
}
