// Turns API values into text and CSS class names. The dashboard never works out
// a risk level, an action or a trend itself: it only formats what the server sent.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Timestamps from the server are UTC; people read them in Philippine time.
const manila = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const score = (n) => String(Math.round(n));
export const index = (n) => Number(n).toFixed(2);
export const points = (n) => Number(n).toFixed(1);
export const percent = (fraction) => `${Math.round(fraction * 100)}%`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Wed 21 Oct 09:10" in Philippine time. */
export function dateTime(iso) {
  const p = Object.fromEntries(manila.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** "Wed 21 Oct" in Philippine time. */
export function date(iso) {
  const p = Object.fromEntries(manila.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** A plain date such as "2026-10-21" is shown as written, with no time zone conversion. */
export function plainDate(text) {
  const [y, m, d] = String(text).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2026-W47" becomes "W47". */
export const weekShort = (label) => String(label).replace(/^\d{4}-/, "");

const RISK = {
  low: { label: "Low", badge: "badge--low", score: "score--low" },
  moderate: { label: "Moderate", badge: "badge--mod", score: "score--mod" },
  elevated: { label: "Elevated", badge: "badge--elev", score: "score--elev" },
  high: { label: "High", badge: "badge--high", score: "score--high" },
};
export const riskLabel = (level) => RISK[level]?.label ?? level;
export const riskBadgeClass = (level) => RISK[level]?.badge ?? "";
export const scoreClass = (level) => RISK[level]?.score ?? "";

const TREND = {
  rising: { icon: "up", label: "Rising", tone: "trend--up" },
  falling: { icon: "down", label: "Falling", tone: "trend--down" },
  flat: { icon: "flat", label: "No change", tone: "trend--flat" },
};
/** { icon, label, tone }: the icon name is drawn by icons.js, the label is for screen readers. */
export const trendInfo = (trend) => TREND[trend] ?? TREND.flat;

const TASK_TYPES = {
  search_and_destroy: "Tier 1 · Search & destroy",
  tier2_verification: "Tier 2 review · Purok verification",
  spot_check: "Spot check",
};
export const taskTypeLabel = (type) => TASK_TYPES[type] ?? type;

const STATUS = {
  new: { label: "Not started", className: "badge badge--dashed" },
  in_progress: { label: "In progress", className: "badge" },
  completed: { label: "Completed", className: "badge badge--solid" },
};
/** { label, className } for a task status. */
export const statusBadge = (status) => STATUS[status] ?? { label: status, className: "badge" };

/**
 * The "Raw data" column of the decision table: { main, sub, assumed }.
 * `assumed` is true when the number is a typical value, not a measurement.
 */
export function rawDataText(key, details, caseWeek) {
  const d = details?.[key] ?? {};
  switch (key) {
    case "weather":
      return d.meanTempC === null || d.meanTempC === undefined
        ? { main: "No weather data yet" }
        : { main: `${d.meanTempC.toFixed(1)} °C average`, sub: `rain on ${d.rainDays} of ${d.rainDaysWindow} days` };
    case "household":
      return {
        main: `${plural(d.reportCount, "report")} · ${percent(d.reportRate)} with breeding sites`,
        sub: `${plural(d.answerCount, "daily answer")} · ${percent(d.answerRate)} yes · confidence: ${d.confidence}`,
      };
    case "symptom":
      return { main: `${plural(d.totalChecks, "check")} · ${d.warningChecks} with warning signs` };
    case "field":
      return d.surveyed
        ? { main: `${d.positive} of ${d.containers} containers positive · ${plural(d.surveys, "survey")}` }
        : { main: `No survey in the last 14 days. A typical rate (${Number(d.prior).toFixed(2)}) is used.`, assumed: true };
    case "cases":
      return { main: `${d.thisWeek} confirmed this week${caseWeek ? ` (${caseWeek})` : ""}`, sub: `${d.lastWeek} last week` };
    default:
      return { main: "" };
  }
}

const parts = (date, options) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...options }).formatToParts(date).map((p) => [p.type, p.value]));

/** "Friday, 6 November 2026" in Philippine time. */
export function longDate(date) {
  const p = parts(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** "5:12:34 PM" in Philippine time. */
export function clockTime(date) {
  const p = parts(date, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  return `${p.hour}:${p.minute}:${p.second} ${String(p.dayPeriod).toUpperCase()}`;
}
