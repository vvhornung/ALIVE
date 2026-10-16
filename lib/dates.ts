// Business dates are calendar days in Colombia, not UTC: after 19:00 in
// Bogotá (UTC-5) the UTC date is already tomorrow.
export const BUSINESS_TIME_ZONE = "America/Bogota";

const bogotaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Bogotá as YYYY-MM-DD. */
export function todayInBogota(now: Date = new Date()): string {
  return bogotaDate.format(now); // en-CA formats as YYYY-MM-DD
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
