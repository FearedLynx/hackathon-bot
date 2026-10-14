const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const MONTH_NAMES = Object.keys(MONTHS);

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Parses Devpost's `submission_period_dates`, e.g.
 * "Aug 31 - Oct 23, 2026", "Oct 05 - 27, 2026", "Nov 01, 2026",
 * "Jul 16, 2026 - Jan 15, 2027".
 */
export function parseDevpostRange(s: string): { start: string; end: string } | null {
  const m = s.trim().match(
    /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?(?: - (?:([A-Z][a-z]{2}) )?(\d{1,2}), (\d{4}))?$/,
  );
  if (!m) return null;
  const [, m1, d1, y1, m2, d2, y2] = m;
  const startMonth = MONTHS[m1];
  if (startMonth === undefined) return null;

  if (!d2) {
    if (!y1) return null;
    const iso = toIso(+y1, startMonth, +d1);
    return { start: iso, end: iso };
  }

  const endMonth = m2 ? MONTHS[m2] : startMonth;
  if (endMonth === undefined) return null;
  const endYear = +y2;
  const startYear = y1 ? +y1 : startMonth > endMonth ? endYear - 1 : endYear;
  return { start: toIso(startYear, startMonth, +d1), end: toIso(endYear, endMonth, +d2) };
}

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Inclusive length in days: a Fri–Sun event is 3 days. */
export const durationDays = (start: string, end: string) => daysBetween(start, end) + 1;

/** "27–29 Nov 2026", "30 Nov – 2 Dec 2026", "30 Dec 2026 – 2 Jan 2027", "1 Nov 2026". */
export function formatRange(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const S = MONTH_NAMES[sm - 1];
  const E = MONTH_NAMES[em - 1];
  if (start === end) return `${sd} ${S} ${sy}`;
  if (sy !== ey) return `${sd} ${S} ${sy} – ${ed} ${E} ${ey}`;
  if (sm !== em) return `${sd} ${S} – ${ed} ${E} ${ey}`;
  return `${sd}–${ed} ${S} ${sy}`;
}
