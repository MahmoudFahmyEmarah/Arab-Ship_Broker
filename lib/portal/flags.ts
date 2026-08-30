// Flag-state → ISO 3166-1 alpha-2 code, for the flag-icons SVG set.
// Vessel flags arrive as free text from circulars/Q88 ("UNION OF COMOROS",
// "St. Vincent & Grenadines") — normalize hard, then look up. Unknown flags
// return null and the UI shows the text alone (never a wrong flag).

const FLAG_CODES: Record<string, string> = {
  // major open registries + everything seen in the platform's data
  panama: "pa", liberia: "lr", "marshall islands": "mh", malta: "mt",
  bahamas: "bs", cyprus: "cy", comoros: "km", "union of comoros": "km",
  barbados: "bb", "san marino": "sm", "st vincent grenadines": "vc",
  "saint vincent and the grenadines": "vc", "st vincent and the grenadines": "vc",
  "st vincent and grenadines": "vc",
  tanzania: "tz", togo: "tg", "togolese rep": "tg", "togolese republic": "tg",
  palau: "pw", cameroon: "cm", "sierra leone": "sl",
  moldova: "md", "cook islands": "ck", vanuatu: "vu", belize: "bz",
  mongolia: "mn", gabon: "ga", honduras: "hn", "st kitts nevis": "kn",
  "saint kitts and nevis": "kn", "st kitts and nevis": "kn",
  dominica: "dm", guyana: "gy", curacao: "cw",
  tuvalu: "tv", niue: "nu", kiribati: "ki", jamaica: "jm",
  "guinea bissau": "gw", ethiopia: "et", greek: "gr",
  // regional + trading nations
  turkey: "tr", turkiye: "tr", egypt: "eg", "united arab emirates": "ae",
  uae: "ae", "saudi arabia": "sa", qatar: "qa", kuwait: "kw", bahrain: "bh",
  oman: "om", jordan: "jo", lebanon: "lb", syria: "sy", iraq: "iq", yemen: "ye",
  greece: "gr", italy: "it", spain: "es", portugal: "pt", netherlands: "nl",
  germany: "de", denmark: "dk", norway: "no", sweden: "se", finland: "fi",
  "united kingdom": "gb", uk: "gb", france: "fr", belgium: "be", ireland: "ie",
  russia: "ru", ukraine: "ua", romania: "ro", bulgaria: "bg", georgia: "ge",
  azerbaijan: "az", moldavia: "md", albania: "al", croatia: "hr",
  montenegro: "me", slovenia: "si", poland: "pl", latvia: "lv", estonia: "ee",
  lithuania: "lt",
  iran: "ir", india: "in", pakistan: "pk", bangladesh: "bd", "sri lanka": "lk",
  china: "cn", "hong kong": "hk", singapore: "sg", "south korea": "kr",
  korea: "kr", japan: "jp", philippines: "ph", vietnam: "vn", indonesia: "id",
  malaysia: "my", thailand: "th", taiwan: "tw",
  algeria: "dz", morocco: "ma", tunisia: "tn", libya: "ly", sudan: "sd",
  djibouti: "dj", somalia: "so", eritrea: "er", kenya: "ke", nigeria: "ng",
  ghana: "gh", senegal: "sn", "usa": "us", "united states": "us",
  brazil: "br", argentina: "ar", mexico: "mx", canada: "ca", australia: "au",
};

export function flagCode(flag: string | null | undefined): string | null {
  if (!flag) return null;
  const key = flag
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key || key === "—") return null;
  return FLAG_CODES[key] ?? FLAG_CODES[key.replace(/^(the|republic of|state of|kingdom of) /, "")] ?? null;
}
