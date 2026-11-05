// Date helpers. All dates are plain "YYYY-MM-DD" strings in UTC, and weeks are
// ISO weeks written "2026-W45" (Monday to Sunday).

const MS_DAY = 86_400_000;

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return formatDate(d) === date ? d : null; // rejects 2026-02-31 and the like
}

function mustParse(date: string): Date {
  const d = parseDate(date);
  if (!d) throw new Error(`Invalid date: ${date}`);
  return d;
}

export function isValidDate(date: string): boolean {
  return parseDate(date) !== null;
}

export function todayUtc(now: Date = new Date()): string {
  return formatDate(now);
}

export function addDays(date: string, n: number): string {
  return formatDate(new Date(mustParse(date).getTime() + n * MS_DAY));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((mustParse(to).getTime() - mustParse(from).getTime()) / MS_DAY);
}

export function dayOfYear(date: string): number {
  return daysBetween(`${date.slice(0, 4)}-01-01`, date) + 1;
}

function mondayOf(d: Date): Date {
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * MS_DAY);
}

export interface IsoWeek {
  year: number;
  week: number;
}

export function isoWeekOf(date: string): IsoWeek {
  const monday = mondayOf(mustParse(date));
  const thursday = new Date(monday.getTime() + 3 * MS_DAY);
  const year = thursday.getUTCFullYear();
  const week1Monday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  const week = Math.round((monday.getTime() - week1Monday.getTime()) / (7 * MS_DAY)) + 1;
  return { year, week };
}

export function formatIsoWeek({ year, week }: IsoWeek): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 52 or 53. December 28 always falls in the last ISO week of its year. */
export function weeksInIsoYear(year: number): number {
  return isoWeekOf(`${year}-12-28`).week;
}

/** Parses "2026-W45" (case-insensitive). Returns null if it is not a real week. */
export function parseIsoWeek(text: string): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/i.exec(text.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (year < 2000 || year > 2100) return null;
  if (week < 1 || week > weeksInIsoYear(year)) return null;
  return { year, week };
}

/** The Monday of the given ISO week. */
export function isoWeekStart({ year, week }: IsoWeek): string {
  const week1Monday = mondayOf(new Date(Date.UTC(year, 0, 4)));
  return formatDate(new Date(week1Monday.getTime() + (week - 1) * 7 * MS_DAY));
}

export function isoWeekLabelOf(date: string): string {
  return formatIsoWeek(isoWeekOf(date));
}

/** Moves a week label forward (n > 0) or back (n < 0). */
export function shiftIsoWeek(label: string, n: number): string {
  const parsed = parseIsoWeek(label);
  if (!parsed) throw new Error(`Invalid ISO week: ${label}`);
  return isoWeekLabelOf(addDays(isoWeekStart(parsed), 7 * n));
}
