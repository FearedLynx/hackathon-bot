// Approximate EUR value of a prize's cash, for sorting only. Rates are rough (late 2026)
// and fixed on purpose: ranking doesn't need live FX.
const EUR_PER: Record<string, number> = {
  "€": 1, EUR: 1,
  $: 0.92, USD: 0.92,
  "£": 1.17, GBP: 1.17,
  "₹": 0.011, INR: 0.011,
  DKK: 0.134, SEK: 0.088, NOK: 0.086, CHF: 1.05, PLN: 0.23, CZK: 0.04,
  "kr": 0.134, // Danish/Nordic kroner written as "kr"
};

const CURRENCY = String.raw`(€|EUR|\$|USD|£|GBP|₹|INR|DKK|SEK|NOK|CHF|PLN|CZK|kr\.?)`;
const NUMBER = String.raw`(\d[\d.,]*)\s?(k|K)?`;

/** "10.000.000" or "10,000,000" or "1,234.5" -> number. */
function parseAmount(raw: string, k: string | undefined): number {
  const n = /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw.replace(/,/g, "");
  const value = Number(n);
  return Number.isFinite(value) ? value * (k ? 1000 : 1) : 0;
}

/**
 * Cash value in EUR. Non-cash prizes, "amount not listed" and amounts taken only from
 * an event's title (unverified) count as 0, so credits never outrank real money.
 */
export function cashValueEur(prize: string | null | undefined): number {
  if (!prize || /^no cash|amount not listed|\(per title\)/i.test(prize)) return 0;
  const cashPart = prize.split(/\s\+\s\d+ non-cash/i)[0];
  let total = 0;
  const re = new RegExp(`${CURRENCY}\\s?${NUMBER}|${NUMBER}\\s?${CURRENCY}`, "gi");
  for (const m of cashPart.matchAll(re)) {
    const [currency, amount, k] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[4], m[5]];
    const rate = EUR_PER[currency.replace(/\.$/, "")] ?? EUR_PER[currency.toUpperCase()] ?? 0;
    total += parseAmount(amount, k) * rate;
  }
  return Math.round(total);
}

export const formatEur = (n: number) =>
  n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `€${Math.round(n / 1000)}k` : `€${n.toLocaleString("en-US")}`;
