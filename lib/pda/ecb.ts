// The European Central Bank's euro foreign exchange reference rates (free, no key), published every TARGET
// working day around 16:00 CET: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// Shape: <Cube><Cube time="2026-10-07"><Cube currency="USD" rate="1.1050"/>…</Cube></Cube>. 1 EUR = rate.
export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_ORIGIN = "https://www.ecb.europa.eu";
/** The daily file is about 2 KB; anything far larger is not the file we expect. */
export const ECB_MAX_BYTES = 64 * 1024;
/** Weekend plus a TARGET holiday: the newest file may be this many days old and still be current. */
export const ECB_MAX_AGE_DAYS = 4;

/** The quote currencies the PDA route view needs from EUR tariffs and for later ports. All are required. */
export const ECB_FEED_CURRENCIES = ["USD", "RON", "TRY"] as const;

export interface EcbDailyRates {
  date: string;
  rates: Record<string, number>;
}

const DATED_OPEN = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g;
const RATE = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/g;

/**
 * Parses the daily file strictly (Codex C2O-089 B2C-041): exactly one dated container; rates are read only inside
 * it; a currency listed twice, a non-positive rate or a missing required currency refuses the whole file.
 */
export function parseEcbDaily(xml: string, required: readonly string[] = ECB_FEED_CURRENCIES): EcbDailyRates {
  const opens = [...xml.matchAll(DATED_OPEN)];
  if (opens.length !== 1) throw new Error(`ECB feed: expected one dated rate set, found ${opens.length}`);
  const open = opens[0];
  const start = open.index! + open[0].length;
  const end = xml.indexOf("</Cube>", start);
  if (end < 0) throw new Error("ECB feed: the dated rate set is not closed");
  const rates: Record<string, number> = {};
  for (const m of xml.slice(start, end).matchAll(RATE)) {
    if (m[1] in rates) throw new Error(`ECB feed: ${m[1]} is listed twice`);
    const value = Number(m[2]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`ECB feed: invalid rate for ${m[1]}`);
    rates[m[1]] = value;
  }
  if (!Object.keys(rates).length) throw new Error("ECB feed: no rates in the file");
  const missing = required.filter((currency) => rates[currency] == null);
  if (missing.length) throw new Error(`ECB feed: required currencies missing: ${missing.join(", ")}`);
  return { date: open[1], rates };
}

/** Refuses a file dated in the future or older than the allowed age (UTC calendar days). */
export function assertEcbFresh(date: string, now: Date = new Date(), maxAgeDays = ECB_MAX_AGE_DAYS): void {
  const day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day)) throw new Error(`ECB feed: invalid date ${date}`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const age = Math.round((today - day) / 86_400_000);
  if (age < 0) throw new Error(`ECB feed: the file is dated ${date}, in the future`);
  if (age > maxAgeDays) throw new Error(`ECB feed: the file is dated ${date}, ${age} days old (stale)`);
}

/** The exact source reference the database binds to the publication date. */
export function ecbSourceRef(date: string): string {
  return `ECB euro foreign exchange reference rates, ${date} (${ECB_DAILY_URL})`;
}

/** The payloads for pda_record_fx_rate_system: EUR → each wanted currency (all present after parseEcbDaily). */
export function ecbFeedPayloads(daily: EcbDailyRates, wanted: readonly string[] = ECB_FEED_CURRENCIES) {
  return wanted.map((currency) => {
    const rate = daily.rates[currency];
    if (rate == null) throw new Error(`ECB feed: ${currency} missing`);
    return {
      baseCurrency: "EUR",
      quoteCurrency: currency,
      rate,
      effectiveOn: daily.date,
      sourceKind: "ecb" as const,
      sourceRef: ecbSourceRef(daily.date),
    };
  });
}

/** Reads the daily file defensively: the final URL must stay on the ECB origin, XML only, bounded size. */
export async function fetchEcbDaily(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(ECB_DAILY_URL, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ECB feed answered ${response.status}`);
  if (response.url && !response.url.startsWith(`${ECB_ORIGIN}/`)) throw new Error("ECB feed: redirected away from the ECB origin");
  const type = response.headers.get("content-type") ?? "";
  if (!/xml/i.test(type)) throw new Error(`ECB feed: unexpected content type ${type || "(none)"}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > ECB_MAX_BYTES) throw new Error("ECB feed: the response is too large");
  const text = await response.text();
  if (text.length > ECB_MAX_BYTES) throw new Error("ECB feed: the response is too large");
  return text;
}
