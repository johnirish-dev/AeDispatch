// Pieces of a barangay row that the dashboard and the priority queue both draw: the
// threat-score bar with its trend arrow, the risk badge and the action. They only
// format what the server sent; the risk level, action and trend are never worked out here.

import { h } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.queue;

// One small outline icon per kind of task: a magnifier for search & destroy, a map pin for a purok
// check, a clipboard for a spot check. They are decoration next to the text, never buttons.
const TASK_ICONS = { search_and_destroy: "search", tier2_verification: "profiles", spot_check: "clipboard" };
export const taskIcon = (type) => h("span", { class: "list__type" }, icon(TASK_ICONS[type] ?? "activity"));

export const ACTIVITY_HREF = "/officer/activity.html";

/** The text of a task row as a link. CSS stretches it over the whole row; screen readers hear where it goes. */
export const taskLink = (text) =>
  h("a", { class: "list__link", href: ACTIVITY_HREF }, text, h("span", { class: "sr-only" }, `, ${strings.officer.overview.assignmentsOpen}`));

/** The decision page of a barangay. `from` ("dashboard" or "queue") is where Back will return to. */
export const decisionHref = (b, from) => `/officer/decision.html?id=${b.barangayId}${from ? `&from=${from}` : ""}`;

export function trendCell(b) {
  const info = fmt.trendInfo(b.trend);
  return h("span", { class: `trend ${info.tone}`, role: "img", "aria-label": info.label }, icon(info.icon));
}

export function scoreCell(b) {
  return h(
    "div",
    { class: `score ${fmt.scoreClass(b.riskLevel)}` },
    h("div", { class: "score__bar", "aria-hidden": "true" }, h("div", { class: "score__fill", style: `--value:${b.score100}` })),
    // Only screen readers hear that the number is a score out of 100 (it is not a percentage).
    h("span", { class: "score__num" }, fmt.score(b.score100), h("span", { class: "sr-only" }, ` ${t.scoreOfSpoken}`)),
    trendCell(b),
  );
}

export const riskBadge = (b) => h("span", { class: `badge ${fmt.riskBadgeClass(b.riskLevel)}` }, fmt.riskLabel(b.riskLevel));

export function actionCell(b, from) {
  return b.action === "tier1"
    ? h("a", { class: "btn btn--primary btn--sm", href: decisionHref(b, from) }, t.reviewTier1)
    : h("a", { class: "btn btn--sm", href: decisionHref(b, from) }, t.viewDetails);
}

/** The small "Tier 2 evidence" badge, or nothing. */
export const tier2Badge = (b) => (b.tier2.unlocked ? h("span", { class: "badge badge--tier2" }, t.tier2Badge) : null);
