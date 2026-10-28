// How long Gift Aid records are kept.
//
// HMRC: six years after the end of the accounting period in which the donor's last
// gift was made. The DRA's accounting period ends on 31 March (the bookkeeper's
// sheet, Settings). Nothing deletes on this date yet -- the field is there so that
// the purge, when it is built, is a query rather than an investigation.

/** 31 March closing the financial year that contains `date` (yyyy-mm-dd). */
export function accountingPeriodEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const endYear = m <= 3 ? y : y + 1;
  return `${endYear}-03-31`;
}

export function retainUntil(lastDate: string): string {
  const end = accountingPeriodEnd(lastDate);
  return `${Number(end.slice(0, 4)) + 6}-03-31`;
}

/** yyyy-mm-dd plus whole days, in calendar terms (no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A verbal declaration's 30-day cancellation window runs from the written confirmation. */
export const VERBAL_CANCEL_DAYS = 30;
