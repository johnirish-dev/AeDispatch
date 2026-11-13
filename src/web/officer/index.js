// Dashboard: today's date, four headline numbers, the barangays that need action today
// (at most three, only those at or above the action threshold) and the field assignments.
// The full ranking, with search, filter and sort, is on the Priority queue page. The order,
// the risk level, the action and the trend all come from the server; this page only
// formats and draws them.

import { ApiError, get } from "../shared/api.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";
import { actionCell, decisionHref, riskBadge, scoreCell, taskIcon, taskLink, tier2Badge } from "./parts.js";

const t = strings.officer.overview;
const QUEUE_HREF = "/officer/queue.html";
const FOCUS_MAX = 3;

const els = {};

// ---- the date -------------------------------------------------------------------------
// The date and time come from the SERVER's clock, not the computer's. Each time the ranking
// loads we learn how far the server's "now" is from this computer's, and the display then
// counts on from there every second. So when the Demo tools set a different date, this
// shows that date and keeps running from it.

let clockOffsetMs = 0;
let clockKnown = false;

function tick() {
  if (!clockKnown) return;
  const now = new Date(Date.now() + clockOffsetMs);
  els.date.textContent = fmt.longDate(now);
  els.time.textContent = fmt.clockTime(now);
  els.clock.dateTime = now.toISOString();
}

// ---- layout (built once; only the data inside changes) -----------------------------

function buildHeader() {
  els.weather = h("div", { class: "temp", "aria-label": t.weatherTitle }, h("span", { class: "skeleton", style: "width:140px" }));
  els.date = h("span", { class: "clock__date" }, "–");
  els.time = h("span", { class: "clock__time" });
  els.clock = h("time", { class: "clock", "aria-label": t.dateLabel }, els.date, els.time);
  return h(
    "header",
    { class: "page-head" },
    h("div", { class: "page-head__left" }, h("h1", { class: "page-title" }, t.title), els.weather),
    els.clock,
  );
}

/** A headline number as a card. The first one is the highlighted green card. */
function statCard(key, label, note, href, hero = false) {
  els[key] = h("div", { class: "stat__value" }, "–");
  els[`${key}Note`] = h("div", { class: "stat__note" }, note);
  els[`${key}Card`] = h(
    "a",
    { class: `stat${hero ? " stat--hero" : ""}`, href },
    h("div", { class: "stat__head" }, h("span", { class: "stat__label" }, label), h("span", { class: "round" }, icon("up"))),
    els[key],
    els[`${key}Note`],
  );
  return els[`${key}Card`];
}

function buildStats() {
  return h(
    "section",
    { class: "stats", "aria-label": t.stats.label },
    statCard("above", t.stats.above, t.stats.aboveNote, QUEUE_HREF, true),
    statCard("monitored", t.stats.monitored, t.stats.monitoredNote, QUEUE_HREF),
    statCard("active", t.stats.active, t.stats.activeNote, "/officer/activity.html"),
    statCard("cases", t.stats.cases, "", "/officer/trends.html"),
  );
}

function buildFocus() {
  els.focusSub = h("p", { class: "card__sub" }, " ");
  els.focusBody = h("div", { class: "focus__body" }, ...Array.from({ length: FOCUS_MAX }, (_, i) => h("span", { class: "skeleton focus__skeleton", style: `width:${92 - i * 8}%` })));
  return h(
    "section",
    { class: "card focus", "aria-labelledby": "focus-title" },
    h(
      "div",
      { class: "card__head" },
      h("div", {}, h("h2", { id: "focus-title" }, t.focus.title), els.focusSub),
      h("a", { class: "btn btn--sm", href: QUEUE_HREF }, t.focus.viewQueue, icon("chevron")),
    ),
    els.focusBody,
  );
}

function buildSide() {
  els.assignments = h("div", {}, h("span", { class: "skeleton", style: "width:80%" }));
  return h(
    "div",
    { class: "side" },
    h(
      "section",
      { class: "card" },
      h("div", { class: "card__head" }, h("h2", {}, t.assignmentsTitle), h("a", { class: "btn btn--sm", href: "/officer/activity.html" }, t.assignmentsAll)),
      els.assignments,
    ),
  );
}

// ---- drawing: barangays that need action ---------------------------------------------

/** One row per barangay: rank, name, score, risk level and the action. */
function focusItem(b) {
  return h(
    "li",
    { class: "focus__item" },
    h("span", { class: "focus__rank", "aria-label": t.focus.rank(b.rank) }, String(b.rank)),
    h(
      "div",
      { class: "focus__name" },
      h("span", { class: "focus__title" }, h("a", { class: "row-link", href: decisionHref(b, "dashboard") }, b.name), tier2Badge(b)),
    ),
    h("div", { class: "focus__score" }, scoreCell(b)),
    h("div", { class: "focus__risk" }, riskBadge(b)),
    h("div", { class: "focus__action" }, actionCell(b, "dashboard")),
  );
}

function renderFocus(barangays) {
  // The server's own order, then only those at or above the action threshold.
  const triggered = barangays.filter((b) => b.action === "tier1");
  const shown = triggered.slice(0, FOCUS_MAX);
  clear(els.focusBody);

  if (shown.length === 0) {
    els.focusSub.textContent = t.focus.sub(0, 0);
    els.focusBody.append(
      h(
        "div",
        { class: "focus__empty" },
        h("span", { class: "focus__emptyicon" }, icon("check")),
        h("p", { class: "focus__emptytitle" }, t.focus.empty),
        h("p", { class: "muted" }, t.focus.emptyNote),
      ),
    );
    return;
  }

  els.focusSub.textContent = t.focus.sub(shown.length, triggered.length);
  els.focusBody.append(h("ul", { class: "focus__list" }, ...shown.map(focusItem)));
  if (triggered.length > shown.length) {
    els.focusBody.append(h("a", { class: "focus__more", href: QUEUE_HREF }, t.focus.more(triggered.length - shown.length), icon("chevron")));
  }
}

function renderRanking(ranking) {
  const { summary, barangays, asOf } = ranking;

  clockOffsetMs = Date.parse(asOf) - Date.now();
  clockKnown = true;
  tick();

  els.above.textContent = String(summary.aboveActionThreshold);
  els.monitored.textContent = String(summary.barangaysMonitored);
  els.active.textContent = String(summary.activeAssignments);
  els.cases.textContent = String(summary.weeklyConfirmedCases);
  els.casesNote.textContent = summary.caseWeek ? t.stats.casesNote(summary.caseWeek) : "";
  els.casesNote.hidden = !summary.caseWeek;

  renderWeather(summary.weather);
  renderFocus(barangays);
}

// ---- drawing: weather and assignments -------------------------------------------------

function renderWeather(w) {
  clear(els.weather);
  if (w.meanTempC === null) {
    els.weather.append(h("span", { class: "temp__main" }, t.weatherNone));
    return;
  }
  els.weather.append(
    h("span", { class: "temp__main" }, t.weatherTemp(Math.round(w.meanTempC))),
    h("span", { class: "temp__sub" }, t.weatherRain(w.rainDays, w.rainDaysWindow)),
  );
  // Node.append() would print "null", so the optional badge is added only when needed.
  if (w.stale) els.weather.append(h("span", { class: "badge badge--dashed", title: w.message ?? "" }, t.staleBadge));
}

function renderAssignments(list) {
  clear(els.assignments);
  if (list.length === 0) {
    els.assignments.append(h("p", { class: "muted" }, t.assignmentsEmpty));
    return;
  }
  const items = list.slice(0, 5).map((a) => {
    const status = fmt.statusBadge(a.status);
    return h(
      "li",
      { class: "list__item list__item--link" },
      taskIcon(a.type),
      h("div", { class: "list__text" }, h("span", { class: "list__title" }, taskLink(a.barangayName)), h("span", { class: "list__sub" }, t.taskShort[a.type] ?? a.type)),
      h("span", { class: status.className }, status.label),
    );
  });
  els.assignments.append(h("ul", { class: "list" }, ...items));
}

// ---- loading ----------------------------------------------------------------------

/** Each part loads on its own, so one failing request never blanks the whole page. */
async function loadRanking() {
  try {
    renderRanking(await get("/api/officer/ranking"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showState(els.focusBody, "error", { message: err.message || t.loadError, onRetry: loadRanking });
  }
}

async function loadSide() {
  try {
    renderAssignments(await get("/api/officer/assignments"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showState(els.assignments, "error", { message: err.message, onRetry: loadSide });
  }
}

function loadAll() {
  loadRanking();
  loadSide();
}

const main = document.getElementById("main");
main.classList.add("main--fit");
main.append(buildHeader(), buildStats(), h("div", { class: "dash" }, buildFocus(), buildSide()));
await mountShell({ active: "overview" });
loadAll();
window.setInterval(tick, 1000);

// Fresh numbers (and a fresh reading of the server clock) when the person comes back to this tab.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadAll();
});
