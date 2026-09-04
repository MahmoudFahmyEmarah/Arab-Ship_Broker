// Maritime flag-state registry — the closed vocabulary for `vessels.flag`.
//
// A FLAG is the ship register a vessel is entered in — a legal term that is not
// the same as a country: Gibraltar, Isle of Man, Bermuda, Hong Kong, Madeira
// (MAR) or Curaçao are flags in their own right, and open registries such as
// Panama or Liberia carry ships with no link to the country at all. The list
// mirrors the flag filter Equasis exposes (every register with tonnage on the
// water, plus "Unknown"), and this module is the single source of truth:
//
//   • the DB table `flag_states` is SEEDED from it (migration 20260902223515)
//     and is what the review dropdowns read at runtime;
//   • `normalizeFlag()` maps the free text brokers actually write ("MI Flag",
//     "Togolese Rep.", "UNION OF COMOROS", "Cameron", "St Kitts & Nevis") onto
//     the canonical name, for staging validation + the DB backfill;
//   • `FLAG_STATE_NAMES` keeps the maritime-first ordering for pickers.
//
// Categories: "open" = open registry / flag of convenience (ITF list + the
// second registers that trade that way), "national" = a closed national or
// territorial register, "unknown" = the explicit "Unknown" bucket.

export type FlagCategory = "open" | "national" | "unknown";

export interface FlagState {
  name: string;          // canonical display name (what gets stored)
  iso2: string | null;   // ISO 3166-1 alpha-2 (flag icon); null for pseudo-entries
  category: FlagCategory;
  aliases: readonly string[]; // extra spellings; matching is punctuation-insensitive
}

// prettier-ignore
export const FLAG_STATES_REGISTRY: readonly FlagState[] = [
  // ── open registries — the bulk of the dry-cargo fleet flies one of these ──
  { name: "Panama",                  iso2: "pa", category: "open", aliases: ["PMA", "Panamanian"] },
  { name: "Liberia",                 iso2: "lr", category: "open", aliases: ["Liberian"] },
  { name: "Marshall Islands",        iso2: "mh", category: "open", aliases: ["MI", "MI Flag", "Marshall Is", "Marshall Isl", "RMI", "Republic of the Marshall Islands"] },
  { name: "Malta",                   iso2: "mt", category: "open", aliases: ["Maltese"] },
  { name: "Bahamas",                 iso2: "bs", category: "open", aliases: ["The Bahamas", "Commonwealth of the Bahamas"] },
  { name: "Cyprus",                  iso2: "cy", category: "open", aliases: ["Cypriot"] },
  { name: "Comoros",                 iso2: "km", category: "open", aliases: ["Union of Comoros", "Union of the Comoros", "Comoro Islands", "Comores"] },
  { name: "Togo",                    iso2: "tg", category: "open", aliases: ["Togolese Rep", "Togolese Republic", "Togolese"] },
  { name: "Palau",                   iso2: "pw", category: "open", aliases: ["Republic of Palau"] },
  { name: "Tanzania",                iso2: "tz", category: "open", aliases: ["Tanzania (Zanzibar)", "Zanzibar", "United Republic of Tanzania"] },
  { name: "Sierra Leone",            iso2: "sl", category: "open", aliases: ["S Leone"] },
  { name: "Cameroon",                iso2: "cm", category: "open", aliases: ["Cameron", "Cameroun", "Republic of Cameroon"] },
  { name: "Gabon",                   iso2: "ga", category: "open", aliases: ["Gabonese Republic"] },
  { name: "Cook Islands",            iso2: "ck", category: "open", aliases: ["Cook Is"] },
  { name: "St. Vincent & Grenadines", iso2: "vc", category: "open", aliases: ["St Vincent & Grenadines", "Saint Vincent and the Grenadines", "St Vincent and the Grenadines", "St Vincent and Grenadines", "SVG", "St. Vincent and the Grenadines", "St Vincent"] },
  { name: "St. Kitts & Nevis",       iso2: "kn", category: "open", aliases: ["St Kitts & Nevis", "Saint Kitts and Nevis", "St Kitts and Nevis", "St. Kitts and Nevis", "St Kitts Nevis", "SKN"] },
  { name: "Antigua & Barbuda",       iso2: "ag", category: "open", aliases: ["Antigua and Barbuda", "Antigua"] },
  { name: "Belize",                  iso2: "bz", category: "open", aliases: [] },
  { name: "Barbados",                iso2: "bb", category: "open", aliases: [] },
  { name: "Bermuda",                 iso2: "bm", category: "open", aliases: [] },
  { name: "Cayman Islands",          iso2: "ky", category: "open", aliases: ["Cayman Is", "Cayman"] },
  { name: "Gibraltar",               iso2: "gi", category: "open", aliases: [] },
  { name: "Isle of Man",             iso2: "im", category: "open", aliases: ["IOM"] },
  { name: "Curaçao",                 iso2: "cw", category: "open", aliases: ["Curacao", "Netherlands Antilles"] },
  { name: "Moldova",                 iso2: "md", category: "open", aliases: ["Moldavia", "Republic of Moldova"] },
  { name: "Mongolia",                iso2: "mn", category: "open", aliases: [] },
  { name: "Honduras",                iso2: "hn", category: "open", aliases: [] },
  { name: "Jamaica",                 iso2: "jm", category: "open", aliases: [] },
  { name: "Dominica",                iso2: "dm", category: "open", aliases: ["Commonwealth of Dominica"] },
  { name: "Vanuatu",                 iso2: "vu", category: "open", aliases: [] },
  { name: "Tuvalu",                  iso2: "tv", category: "open", aliases: [] },
  { name: "Niue",                    iso2: "nu", category: "open", aliases: [] },
  { name: "Kiribati",                iso2: "ki", category: "open", aliases: [] },
  { name: "Tonga",                   iso2: "to", category: "open", aliases: [] },
  { name: "Samoa",                   iso2: "ws", category: "open", aliases: ["Western Samoa"] },
  { name: "Guinea-Bissau",           iso2: "gw", category: "open", aliases: ["Guinea Bissau"] },
  { name: "Equatorial Guinea",       iso2: "gq", category: "open", aliases: [] },
  { name: "São Tomé & Príncipe",     iso2: "st", category: "open", aliases: ["Sao Tome and Principe", "Sao Tome & Principe", "Sao Tome"] },
  { name: "Mauritius",               iso2: "mu", category: "open", aliases: [] },
  { name: "Madeira",                 iso2: "pt", category: "open", aliases: ["Portugal (MAR)", "MAR", "Madeira (MAR)", "Portugal Madeira"] },
  { name: "Faroe Islands",           iso2: "fo", category: "open", aliases: ["Faroes", "Faeroe Islands", "FAS", "Faroe Islands (FAS)"] },
  { name: "Cambodia",                iso2: "kh", category: "open", aliases: ["Kampuchea"] },
  { name: "Bolivia",                 iso2: "bo", category: "open", aliases: [] },
  { name: "Georgia",                 iso2: "ge", category: "open", aliases: [] },
  { name: "Lebanon",                 iso2: "lb", category: "open", aliases: ["Lebanese"] },
  { name: "Sri Lanka",               iso2: "lk", category: "open", aliases: ["Ceylon"] },
  { name: "Myanmar",                 iso2: "mm", category: "open", aliases: ["Burma"] },
  { name: "North Korea",             iso2: "kp", category: "open", aliases: ["Korea, DPR", "DPRK", "Korea (North)", "Democratic People's Republic of Korea"] },
  { name: "San Marino",              iso2: "sm", category: "open", aliases: [] },
  { name: "Eswatini",                iso2: "sz", category: "open", aliases: ["Swaziland"] },
  { name: "Gambia",                  iso2: "gm", category: "open", aliases: ["The Gambia"] },
  { name: "Guyana",                  iso2: "gy", category: "open", aliases: [] },
  { name: "Micronesia",              iso2: "fm", category: "open", aliases: ["Federated States of Micronesia", "FSM"] },
  { name: "Timor-Leste",             iso2: "tl", category: "open", aliases: ["East Timor"] },

  // ── region: Arab world, Turkey, Black Sea, Med ─────────────────────────────
  { name: "Egypt",                   iso2: "eg", category: "national", aliases: ["Egyptian", "Arab Republic of Egypt"] },
  { name: "Saudi Arabia",            iso2: "sa", category: "national", aliases: ["KSA", "Kingdom of Saudi Arabia"] },
  { name: "United Arab Emirates",    iso2: "ae", category: "national", aliases: ["UAE", "U.A.E."] },
  { name: "Qatar",                   iso2: "qa", category: "national", aliases: [] },
  { name: "Kuwait",                  iso2: "kw", category: "national", aliases: [] },
  { name: "Bahrain",                 iso2: "bh", category: "national", aliases: [] },
  { name: "Oman",                    iso2: "om", category: "national", aliases: ["Sultanate of Oman"] },
  { name: "Yemen",                   iso2: "ye", category: "national", aliases: [] },
  { name: "Iraq",                    iso2: "iq", category: "national", aliases: [] },
  { name: "Jordan",                  iso2: "jo", category: "national", aliases: [] },
  { name: "Syria",                   iso2: "sy", category: "national", aliases: ["Syrian Arab Republic"] },
  { name: "Libya",                   iso2: "ly", category: "national", aliases: [] },
  { name: "Tunisia",                 iso2: "tn", category: "national", aliases: [] },
  { name: "Algeria",                 iso2: "dz", category: "national", aliases: [] },
  { name: "Morocco",                 iso2: "ma", category: "national", aliases: [] },
  { name: "Mauritania",              iso2: "mr", category: "national", aliases: [] },
  { name: "Sudan",                   iso2: "sd", category: "national", aliases: [] },
  { name: "Djibouti",                iso2: "dj", category: "national", aliases: [] },
  { name: "Somalia",                 iso2: "so", category: "national", aliases: [] },
  { name: "Eritrea",                 iso2: "er", category: "national", aliases: [] },
  { name: "Iran",                    iso2: "ir", category: "national", aliases: ["Islamic Republic of Iran"] },
  { name: "Turkey",                  iso2: "tr", category: "national", aliases: ["Türkiye", "Turkiye", "Turkish"] },
  { name: "Greece",                  iso2: "gr", category: "national", aliases: ["Greek", "Hellenic"] },
  { name: "Italy",                   iso2: "it", category: "national", aliases: ["Italian"] },
  { name: "Spain",                   iso2: "es", category: "national", aliases: ["Canary Islands", "Spain (REC)"] },
  { name: "Portugal",                iso2: "pt", category: "national", aliases: [] },
  { name: "France",                  iso2: "fr", category: "national", aliases: ["France (RIF)", "RIF", "French International Register"] },
  { name: "Croatia",                 iso2: "hr", category: "national", aliases: [] },
  { name: "Slovenia",                iso2: "si", category: "national", aliases: [] },
  { name: "Montenegro",              iso2: "me", category: "national", aliases: [] },
  { name: "Albania",                 iso2: "al", category: "national", aliases: [] },
  { name: "Bulgaria",                iso2: "bg", category: "national", aliases: [] },
  { name: "Romania",                 iso2: "ro", category: "national", aliases: [] },
  { name: "Ukraine",                 iso2: "ua", category: "national", aliases: [] },
  { name: "Russia",                  iso2: "ru", category: "national", aliases: ["Russian Federation"] },
  { name: "Azerbaijan",              iso2: "az", category: "national", aliases: [] },
  { name: "Kazakhstan",              iso2: "kz", category: "national", aliases: [] },
  { name: "Turkmenistan",            iso2: "tm", category: "national", aliases: [] },
  { name: "Israel",                  iso2: "il", category: "national", aliases: [] },

  // ── Europe ────────────────────────────────────────────────────────────────
  { name: "United Kingdom",          iso2: "gb", category: "national", aliases: ["UK", "Great Britain", "British", "England"] },
  { name: "Ireland",                 iso2: "ie", category: "national", aliases: [] },
  { name: "Netherlands",             iso2: "nl", category: "national", aliases: ["Holland", "The Netherlands", "Dutch"] },
  { name: "Belgium",                 iso2: "be", category: "national", aliases: [] },
  { name: "Luxembourg",              iso2: "lu", category: "national", aliases: [] },
  { name: "Germany",                 iso2: "de", category: "national", aliases: ["German", "Germany (GIS)"] },
  { name: "Denmark",                 iso2: "dk", category: "national", aliases: ["Denmark (DIS)", "DIS", "Danish"] },
  { name: "Norway",                  iso2: "no", category: "national", aliases: ["Norway (NIS)", "NIS", "Norway (NOR)", "Norwegian"] },
  { name: "Sweden",                  iso2: "se", category: "national", aliases: [] },
  { name: "Finland",                 iso2: "fi", category: "national", aliases: [] },
  { name: "Iceland",                 iso2: "is", category: "national", aliases: [] },
  { name: "Poland",                  iso2: "pl", category: "national", aliases: [] },
  { name: "Estonia",                 iso2: "ee", category: "national", aliases: [] },
  { name: "Latvia",                  iso2: "lv", category: "national", aliases: [] },
  { name: "Lithuania",               iso2: "lt", category: "national", aliases: [] },
  { name: "Switzerland",             iso2: "ch", category: "national", aliases: [] },
  { name: "Austria",                 iso2: "at", category: "national", aliases: [] },
  { name: "Jersey",                  iso2: "je", category: "national", aliases: [] },
  { name: "Guernsey",                iso2: "gg", category: "national", aliases: [] },
  { name: "Åland Islands",           iso2: "ax", category: "national", aliases: ["Aland Islands", "Aland"] },
  { name: "Greenland",               iso2: "gl", category: "national", aliases: [] },
  { name: "Monaco",                  iso2: "mc", category: "national", aliases: [] },

  // ── Asia-Pacific ──────────────────────────────────────────────────────────
  { name: "China",                   iso2: "cn", category: "national", aliases: ["PRC", "People's Republic of China", "Chinese"] },
  { name: "Hong Kong",               iso2: "hk", category: "national", aliases: ["Hong Kong SAR", "Hong Kong, China", "HK"] },
  { name: "Macao",                   iso2: "mo", category: "national", aliases: ["Macau"] },
  { name: "Taiwan",                  iso2: "tw", category: "national", aliases: ["Taiwan, China", "Chinese Taipei"] },
  { name: "Japan",                   iso2: "jp", category: "national", aliases: ["Japanese"] },
  { name: "South Korea",             iso2: "kr", category: "national", aliases: ["Korea", "Korea, Republic of", "Republic of Korea", "Korea (South)"] },
  { name: "Singapore",               iso2: "sg", category: "national", aliases: [] },
  { name: "Malaysia",                iso2: "my", category: "national", aliases: [] },
  { name: "Indonesia",               iso2: "id", category: "national", aliases: [] },
  { name: "Philippines",             iso2: "ph", category: "national", aliases: [] },
  { name: "Vietnam",                 iso2: "vn", category: "national", aliases: ["Viet Nam"] },
  { name: "Thailand",                iso2: "th", category: "national", aliases: [] },
  { name: "Brunei",                  iso2: "bn", category: "national", aliases: ["Brunei Darussalam"] },
  { name: "India",                   iso2: "in", category: "national", aliases: ["Indian"] },
  { name: "Pakistan",                iso2: "pk", category: "national", aliases: [] },
  { name: "Bangladesh",              iso2: "bd", category: "national", aliases: [] },
  { name: "Maldives",                iso2: "mv", category: "national", aliases: [] },
  { name: "Australia",               iso2: "au", category: "national", aliases: [] },
  { name: "New Zealand",             iso2: "nz", category: "national", aliases: [] },
  { name: "Papua New Guinea",        iso2: "pg", category: "national", aliases: ["PNG"] },
  { name: "Fiji",                    iso2: "fj", category: "national", aliases: [] },
  { name: "Solomon Islands",         iso2: "sb", category: "national", aliases: [] },
  { name: "New Caledonia",           iso2: "nc", category: "national", aliases: [] },
  { name: "French Polynesia",        iso2: "pf", category: "national", aliases: [] },
  { name: "Wallis & Futuna",         iso2: "wf", category: "national", aliases: ["Wallis and Futuna"] },
  { name: "French Southern Territories", iso2: "tf", category: "national", aliases: ["Kerguelen", "TAAF", "French Southern and Antarctic Lands"] },

  // ── Africa ────────────────────────────────────────────────────────────────
  { name: "Nigeria",                 iso2: "ng", category: "national", aliases: [] },
  { name: "Ghana",                   iso2: "gh", category: "national", aliases: [] },
  { name: "Ivory Coast",             iso2: "ci", category: "national", aliases: ["Côte d'Ivoire", "Cote d'Ivoire", "Cote dIvoire"] },
  { name: "Senegal",                 iso2: "sn", category: "national", aliases: [] },
  { name: "Guinea",                  iso2: "gn", category: "national", aliases: [] },
  { name: "Benin",                  iso2: "bj", category: "national", aliases: [] },
  { name: "Congo",                   iso2: "cg", category: "national", aliases: ["Republic of the Congo", "Congo (Brazzaville)"] },
  { name: "DR Congo",                iso2: "cd", category: "national", aliases: ["Democratic Republic of the Congo", "Congo (Kinshasa)", "Zaire"] },
  { name: "Angola",                  iso2: "ao", category: "national", aliases: [] },
  { name: "Namibia",                 iso2: "na", category: "national", aliases: [] },
  { name: "South Africa",            iso2: "za", category: "national", aliases: ["RSA"] },
  { name: "Mozambique",              iso2: "mz", category: "national", aliases: [] },
  { name: "Madagascar",              iso2: "mg", category: "national", aliases: [] },
  { name: "Seychelles",              iso2: "sc", category: "national", aliases: [] },
  { name: "Kenya",                    iso2: "ke", category: "national", aliases: [] },
  { name: "Ethiopia",                iso2: "et", category: "national", aliases: [] },
  { name: "Cape Verde",              iso2: "cv", category: "national", aliases: ["Cabo Verde"] },

  // ── Americas ──────────────────────────────────────────────────────────────
  { name: "United States",           iso2: "us", category: "national", aliases: ["USA", "US", "United States of America", "U.S.A."] },
  { name: "Canada",                  iso2: "ca", category: "national", aliases: [] },
  { name: "Mexico",                  iso2: "mx", category: "national", aliases: [] },
  { name: "Brazil",                  iso2: "br", category: "national", aliases: [] },
  { name: "Argentina",               iso2: "ar", category: "national", aliases: [] },
  { name: "Chile",                   iso2: "cl", category: "national", aliases: [] },
  { name: "Peru",                    iso2: "pe", category: "national", aliases: [] },
  { name: "Ecuador",                 iso2: "ec", category: "national", aliases: [] },
  { name: "Colombia",                iso2: "co", category: "national", aliases: [] },
  { name: "Venezuela",               iso2: "ve", category: "national", aliases: [] },
  { name: "Uruguay",                 iso2: "uy", category: "national", aliases: [] },
  { name: "Paraguay",                iso2: "py", category: "national", aliases: [] },
  { name: "Cuba",                    iso2: "cu", category: "national", aliases: [] },
  { name: "Dominican Republic",      iso2: "do", category: "national", aliases: [] },
  { name: "Haiti",                   iso2: "ht", category: "national", aliases: [] },
  { name: "Trinidad & Tobago",       iso2: "tt", category: "national", aliases: ["Trinidad and Tobago"] },
  { name: "Grenada",                 iso2: "gd", category: "national", aliases: [] },
  { name: "St. Lucia",               iso2: "lc", category: "national", aliases: ["Saint Lucia", "St Lucia"] },
  { name: "Aruba",                   iso2: "aw", category: "national", aliases: [] },
  { name: "Sint Maarten",            iso2: "sx", category: "national", aliases: ["St Maarten"] },
  { name: "Anguilla",                iso2: "ai", category: "national", aliases: [] },
  { name: "British Virgin Islands",  iso2: "vg", category: "national", aliases: ["BVI", "Virgin Islands (British)"] },
  { name: "US Virgin Islands",       iso2: "vi", category: "national", aliases: ["Virgin Islands (US)", "U.S. Virgin Islands"] },
  { name: "Turks & Caicos Islands",  iso2: "tc", category: "national", aliases: ["Turks and Caicos Islands", "Turks and Caicos"] },
  { name: "Montserrat",              iso2: "ms", category: "national", aliases: [] },
  { name: "Puerto Rico",             iso2: "pr", category: "national", aliases: [] },
  { name: "Falkland Islands",        iso2: "fk", category: "national", aliases: ["Falklands", "Malvinas"] },
  { name: "St. Helena",              iso2: "sh", category: "national", aliases: ["Saint Helena"] },
  { name: "Guatemala",               iso2: "gt", category: "national", aliases: [] },
  { name: "Nicaragua",               iso2: "ni", category: "national", aliases: [] },
  { name: "Costa Rica",              iso2: "cr", category: "national", aliases: [] },
  { name: "El Salvador",             iso2: "sv", category: "national", aliases: [] },
  { name: "Suriname",                iso2: "sr", category: "national", aliases: [] },

  // ── the explicit "don't know" bucket (Equasis lists it too) ───────────────
  { name: "Unknown",                 iso2: null, category: "unknown", aliases: ["Not Known", "N/K", "Unknown flag", "Flag unknown", "TBA", "TBN"] },
];

/** Maritime-first ordering: open registries, then the rest alphabetically, "Unknown" last. */
export const FLAG_STATE_NAMES: readonly string[] = (() => {
  const open = FLAG_STATES_REGISTRY.filter((f) => f.category === "open").map((f) => f.name);
  const nat = FLAG_STATES_REGISTRY.filter((f) => f.category === "national").map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
  return [...open, ...nat, "Unknown"];
})();

// Match key: lower-case, accents stripped, every non-alphanumeric run collapsed
// to a single space, "saint"→"st", and connective noise ("the", "and", "of",
// "republic", "flag") dropped — so "Saint Kitts and Nevis", "St. Kitts & Nevis"
// and "ST KITTS NEVIS" all key to "st kitts nevis".
export function flagKey(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\b(the|and|of|republic|rep|islamic|kingdom|state|union|flag|federation|commonwealth)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of FLAG_STATES_REGISTRY) {
    m.set(flagKey(f.name), f.name);
    for (const a of f.aliases) m.set(flagKey(a), f.name);
  }
  return m;
})();

// Things brokers put in the flag column that are NOT flags (class societies,
// P&I clubs, statuses). Recognised so they normalise to null rather than
// being stored as a bogus register.
const NOT_A_FLAG = new Set(["iacs", "bv", "dnv", "abs", "lr", "nk", "rina", "ccs", "krs", "rs", "tbc", "n a", "na", "nil", "none"]);

/**
 * Canonical flag-state name for free text, or null when it is not a known
 * register. "Unknown" (and its aliases) return "Unknown" — an explicit value,
 * distinct from an unrecognised string.
 */
export function normalizeFlag(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const key = flagKey(String(raw));
  if (!key) return null;
  if (NOT_A_FLAG.has(key)) return null;
  return LOOKUP.get(key) ?? null;
}

export function isKnownFlag(raw: string | null | undefined): boolean {
  return normalizeFlag(raw) != null;
}
