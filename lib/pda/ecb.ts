// The European Central Bank's euro foreign exchange reference rates (free, no key), published every TARGET
// working day around 16:00 CET: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
// Shape: <Cube><Cube time="2026-10-07"><Cube currency="USD" rate="1.1050"/>…</Cube></Cube>. 1 EUR = rate.
export const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** The quote currencies the PDA route view needs from EUR tariffs and for later ports. */
export const ECB_FEED_CURRENCIES = ["USD", "RON", "TRY"] as const;

export interface EcbDailyRates {
  date: string;
  rates: Record<string, number>;
}

/** Parses the daily file; refuses anything that is not exactly one dated set of positive rates. */
export function parseEcbDaily(xml: string): EcbDailyRates {
  const dates = [...xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>/g)].map((m) => m[1]);
  if (dates.length !== 1) throw new Error(`ECB feed: expected one dated rate set, found ${dates.length}`);
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/>/g)) {
    const value = Number(m[2]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`ECB feed: invalid rate for ${m[1]}`);
    rates[m[1]] = value;
  }
  if (!Object.keys(rates).length) throw new Error("ECB feed: no rates in the file");
  return { date: dates[0], rates };
}

/** The payloads for pda_record_fx_rate_system: EUR → each wanted currency the file carries. */
export function ecbFeedPayloads(daily: EcbDailyRates, wanted: readonly string[] = ECB_FEED_CURRENCIES) {
  return wanted
    .filter((currency) => daily.rates[currency] != null)
    .map((currency) => ({
      baseCurrency: "EUR",
      quoteCurrency: currency,
      rate: daily.rates[currency],
      effectiveOn: daily.date,
      sourceKind: "ecb" as const,
      sourceRef: `ECB euro foreign exchange reference rates, ${daily.date} (${ECB_DAILY_URL})`,
    }));
}
