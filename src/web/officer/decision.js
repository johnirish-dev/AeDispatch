// Decision page: why a barangay is ranked where it is (every factor with its raw data, index,
// weight and points), the Tier 2 evidence, the Tier 1 recommendation the officer can confirm or
// reject. Nothing becomes a field task until the officer ticks the review box and confirms. The
// numbers, the risk level and which tiers are offered all come from the server; this page only
// formats and draws them.

import { ApiError, get, post } from "../shared/api.js";
import { announce, clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { mountShell } from "../shared/shell.js";
import { taskIcon, taskLink } from "./parts.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.decision;
const FACTORS = ["weather", "household", "symptom", "field", "cases"];
const TASK_TYPE = { 1: "search_and_destroy", 2: "tier2_verification" };
const MIN_REASON = 10;
// Back returns to the page the person came from: the dashboard or the priority queue (the default).
const fromDashboard = new URLSearchParams(window.location.search).get("from") === "dashboard";
const BACK = fromDashboard ? { href: "/officer/", label: strings.officer.decision.backDashboard } : { href: "/officer/queue.html", label: strings.officer.decision.back };

const id = Number(new URLSearchParams(window.location.search).get("id"));
const els = {};
let view = null;

// ---- small pieces -------------------------------------------------------------------

function showBanner(kind, text, link) {
  clear(els.banners);
  const banner = h(
    "div",
    { class: `banner banner--${kind}`, role: kind === "error" ? "alert" : "status", tabindex: "-1" },
    h("span", {}, text),
    link ? h("a", { href: link.href, class: "banner__link" }, link.label) : null,
  );
  els.banners.append(banner);
  announce(text, { assertive: kind === "error" });
  banner.focus();
}

const clearBanner = () => clear(els.banners);

// ---- "Why this barangay?" -----------------------------------------------------------

function whyRow(factor) {
  const raw = fmt.rawDataText(factor.key, view.details, view.caseWeek);
  return h(
    "tr",
    {},
    h("th", { scope: "row" }, t.factorNames[factor.key] ?? factor.key),
    h(
      "td",
      { class: `raw${raw.assumed ? " assumed" : ""}` },
      raw.main,
      raw.sub ? h("small", {}, raw.sub) : null,
    ),
    h("td", { class: "num" }, fmt.index(factor.index)),
    h("td", { class: "num" }, fmt.index(factor.weight)),
    h("td", { class: "num" }, fmt.points(factor.points)),
  );
}

// The three number columns are right-aligned so the digits line up.
const NUMERIC_COLUMNS = ["index", "weight", "points"];

function buildWhy() {
  const byKey = new Map(view.factors.map((f) => [f.key, f]));
  const rows = FACTORS.map((key) => byKey.get(key)).filter(Boolean).map(whyRow);
  const s = view.score;
  return h(
    "section",
    { class: "card why" },
    h("h2", {}, t.whyTitle),
    h(
      "div",
      { class: "table-wrap", style: "margin-top: var(--s-4)" },
      h(
        "table",
        { class: "table" },
        h("caption", { class: "sr-only" }, t.whyCaption),
        h(
          "thead",
          {},
          h("tr", {}, ...Object.entries(t.columns).map(([key, label]) => h("th", { scope: "col", class: NUMERIC_COLUMNS.includes(key) ? "num" : null }, label))),
        ),
        h(
          "tbody",
          {},
          ...rows,
          h("tr", { class: "is-total" }, h("td", { colspan: 4 }, t.subtotal), h("td", { class: "num" }, fmt.points(s.subtotal))),
          h("tr", { class: "is-total" }, h("td", { colspan: 3 }, t.density), h("td", { class: "num" }, t.densityRatio(Number(s.densityRatio).toFixed(2))), h("td", { class: "num" }, `×${Number(s.densityFactor).toFixed(2)}`)),
          h("tr", { class: "is-total" }, h("td", { colspan: 4 }, t.threat), h("td", { class: "num" }, fmt.score(s.score100))),
        ),
      ),
    ),
  );
}

// ---- Tier 2 evidence ----------------------------------------------------------------

function buildEvidence() {
  const min = view.tier2.minCases;
  const hot = new Set(view.tier2.puroks.map((p) => p.purok));
  const body =
    view.purokCases.length === 0
      ? h("p", { class: "muted" }, t.noPuroks)
      : h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, t.purokColumn), h("th", { scope: "col" }, t.casesColumn))),
            h(
              "tbody",
              {},
              ...view.purokCases.map((p) =>
                h(
                  "tr",
                  { class: hot.has(p.purok) ? "is-hot" : null },
                  h("th", { scope: "row" }, p.purok),
                  h("td", {}, String(p.cases), hot.has(p.purok) ? h("span", { class: "badge badge--sm" }, t.qualifies(min)) : null),
                ),
              ),
            ),
          ),
        );
  return h(
    "section",
    { class: "card" },
    h("h2", {}, t.evidenceTitle),
    h("p", { class: "card__sub" }, t.evidenceSub),
    h("div", { style: "margin-top: var(--s-4)" }, body),
    h("p", { class: "muted", style: "margin-top: var(--s-3); font-size: var(--fs-sm)" }, t.rule(min)),
  );
}

// ---- the two recommendation cards ----------------------------------------------------

/**
 * One recommendation card. `tier` is 1 or 2. The confirm button stays disabled until the review
 * box is ticked. Reject opens a panel inside the card (no pop-up): focus moves into the reason
 * box when it opens and back to the Reject button when it closes.
 */
/** Nothing to tick or press: say what already exists and where it stands. */
function assignedCard(openTask, badgeText) {
  const status = fmt.statusBadge(openTask.status);
  return h(
    "div",
    { class: "tier__body" },
    h("div", { class: "tier__badges" }, h("span", { class: "badge badge--solid" }, badgeText)),
    h("h3", { class: "tier__title" }, t.assigned.title),
    h("p", { class: "tier__text" }, t.assigned.text),
    h("p", { class: "tier__status" }, h("span", { class: "muted" }, `${t.assigned.statusLabel}: `), h("span", { class: status.className }, status.label), h("span", { class: "muted" }, ` ${t.assigned.meaning[openTask.status] ?? ""}`)),
    h("a", { class: "btn btn--sm", href: "/officer/activity.html" }, t.viewActivity),
  );
}

function tierCard(tier) {
  const text = t.tier1;
  const openTask = view.openTasks.find((task) => task.type === TASK_TYPE[tier]);
  if (openTask) return assignedCard(openTask, text.badge);

  const review = h("input", { type: "checkbox", id: `review-${tier}` });
  const confirmBtn = h("button", { class: "btn btn--primary", type: "button", disabled: true }, t.confirm);
  const rejectBtn = h("button", { class: "btn", type: "button" }, t.reject);

  const reason = h("textarea", { class: "textarea", id: `reason-${tier}`, rows: 3, maxlength: 1000, "aria-describedby": `reason-help-${tier}` });
  const counter = h("span", { class: "reject__counter", "aria-hidden": "true" }, t.counter(0));
  const recordBtn = h("button", { class: "btn btn--primary", type: "button", disabled: true }, t.record);
  const cancelBtn = h("button", { class: "btn", type: "button" }, t.cancel);

  const actions = h("div", {}, h("label", { class: "check", for: `review-${tier}` }, review, h("span", {}, t.review)), h("div", { class: "tier__actions" }, confirmBtn, rejectBtn));
  const panel = h(
    "div",
    { class: "reject", hidden: true },
    h("h3", {}, t.rejectTitle),
    h(
      "div",
      { class: "field" },
      h("label", { class: "field__label", for: `reason-${tier}` }, t.reason),
      reason,
      h("div", { class: "reject__foot" }, h("span", { class: "field__help", id: `reason-help-${tier}` }, t.reasonHelp), counter),
    ),
    h("div", { class: "tier__actions" }, recordBtn, cancelBtn),
  );

  review.addEventListener("change", () => {
    confirmBtn.disabled = !review.checked;
  });
  reason.addEventListener("input", () => {
    const n = reason.value.trim().length;
    counter.textContent = t.counter(Math.min(n, MIN_REASON));
    recordBtn.disabled = n < MIN_REASON;
  });
  rejectBtn.addEventListener("click", () => {
    actions.hidden = true;
    panel.hidden = false;
    reason.focus();
  });
  cancelBtn.addEventListener("click", () => {
    panel.hidden = true;
    actions.hidden = false;
    rejectBtn.focus();
  });

  async function decide(button, busyLabel, path, body, doneText, doneLink) {
    clearBanner();
    const label = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await post(`/api/officer/barangays/${id}/${path}`, body);
      await refresh();
      showBanner("success", doneText, doneLink);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      button.textContent = label;
      button.disabled = false;
      showBanner("error", err.message || strings.common.serverError);
    }
  }
  confirmBtn.addEventListener("click", () =>
    decide(confirmBtn, t.confirming, "confirm", { tier, reviewed: true }, t.confirmed, { href: "/officer/activity.html", label: t.viewActivity }),
  );
  recordBtn.addEventListener("click", () =>
    decide(recordBtn, t.recording, "reject", { tier, reason: reason.value.trim() }, t.rejected, { href: BACK.href, label: BACK.label }),
  );

  return h(
    "div",
    { class: "tier__body" },
    h("div", { class: "tier__badges" }, h("span", { class: "badge badge--solid" }, text.badge)),
    h("h3", { class: "tier__title" }, text.title),
    h("p", { class: "tier__text" }, text.text),
    actions,
    panel,
  );
}

/** Where Tier 1 is not recommended the officer can still ask the BHW for an inspection (a spot check). */
function fieldInspectionCard() {
  const open = view.openTasks.find((task) => task.type === "spot_check" || task.type === "search_and_destroy");
  if (open) return h("section", { class: "card" }, assignedCard(open, t.field.badge));

  const review = h("input", { type: "checkbox", id: "review-spot" });
  const note = h("textarea", { class: "textarea", id: "spot-note", rows: 2, maxlength: 300, "aria-describedby": "spot-note-help" });
  const assignBtn = h("button", { class: "btn btn--primary", type: "button", disabled: true }, t.field.assign);
  review.addEventListener("change", () => {
    assignBtn.disabled = !review.checked;
  });
  assignBtn.addEventListener("click", async () => {
    clearBanner();
    assignBtn.disabled = true;
    assignBtn.textContent = t.field.assigning;
    try {
      await post(`/api/officer/barangays/${id}/spot-check`, { reviewed: true, note: note.value.trim() || undefined });
      await refresh();
      showBanner("success", t.field.done, { href: "/officer/activity.html", label: t.viewActivity });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      assignBtn.textContent = t.field.assign;
      assignBtn.disabled = !review.checked;
      showBanner("error", err.message || strings.common.serverError);
    }
  });
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "tier__body" },
      h("div", { class: "tier__badges" }, h("span", { class: "badge badge--dashed" }, t.field.badge)),
      h("h3", { class: "tier__title" }, t.field.title),
      h("p", { class: "tier__text" }, t.field.text(view.score.score100, view.tier1.threshold)),
      h("div", { class: "field" }, h("label", { class: "field__label", for: "spot-note" }, t.field.noteLabel), note, h("p", { class: "field__help", id: "spot-note-help" }, t.field.noteHelp)),
      h("label", { class: "check", for: "review-spot" }, review, h("span", {}, t.field.review)),
      h("div", { class: "tier__actions" }, assignBtn),
    ),
  );
}

function buildTier1() {
  if (!view.tier1.available) return fieldInspectionCard();
  return h("section", { class: "card card--emphasis" }, tierCard(1));
}

function buildTier2() {
  if (!view.tier2.unlocked) {
    return h(
      "section",
      { class: "card card--muted" },
      h("div", { class: "tier__badges" }, h("span", { class: "badge badge--dashed" }, t.tier2.badge), h("span", { class: "badge badge--dashed" }, t.tier2.locked)),
      h("p", { class: "tier__text", style: "margin-top: var(--s-3)" }, t.tier2.lockedText),
    );
  }
  // Tier 2 is advice only: the same health officers decide and do any fogging, outside the system.
  return h(
    "section",
    { class: "card card--tier2" },
    h("div", { class: "tier__badges" }, h("span", { class: "badge badge--tier2" }, t.tier2.badge), h("span", { class: "badge" }, t.tier2.recommended)),
    h("h3", { class: "tier__title" }, t.tier2.recommendedTitle),
    h("p", { class: "tier__text" }, t.tier2.recommendedText),
    h("ul", { class: "tier__list" }, ...view.tier2.puroks.map((p) => h("li", {}, t.tier2.puroks(p.purok, p.cases)))),
    h("p", { class: "tier__advice" }, t.tier2.advisory),
  );
}

// ---- recent activity ------------------------------------------------------------------

function buildRecent() {
  const tasks = view.openTasks.map((task) => {
    const status = fmt.statusBadge(task.status);
    return h(
      "li",
      { class: "list__item list__item--link" },
      taskIcon(task.type),
      h("div", { class: "list__text" }, h("span", { class: "list__title" }, taskLink(fmt.taskTypeLabel(task.type))), h("span", { class: "list__sub" }, (task.puroks ?? []).join(", "))),
      h("span", { class: status.className }, status.label),
    );
  });
  const decisions = view.recentDecisions.map((d) =>
    h(
      "li",
      { class: "list__item" },
      h("span", { class: "list__type" }, icon(d.status === "rejected" ? "close" : "check")),
      h(
        "div",
        { class: "list__text" },
        h("span", { class: "list__title" }, `${t.tierName[d.tier] ?? `Tier ${d.tier}`} · ${t.decisionStatus[d.status] ?? d.status}`),
        h("span", { class: "list__sub" }, d.reason ? `“${d.reason}”` : fmt.dateTime(d.decidedAt ?? d.createdAt)),
      ),
    ),
  );
  const items = [...tasks, ...decisions];
  return h("section", { class: "card" }, h("h2", {}, t.recentTitle), items.length === 0 ? h("p", { class: "muted", style: "margin-top: var(--s-3)" }, t.recentNone) : h("ul", { class: "list", style: "margin-top: var(--s-4)" }, ...items));
}

// ---- drawing the page -----------------------------------------------------------------

function renderHeader() {
  const s = view.score;
  clear(els.title);
  els.title.append(
    h("h1", { class: "page-title" }, view.barangay.name),
    h("span", { class: `badge ${fmt.riskBadgeClass(s.riskLevel)}` }, `${fmt.riskLabel(s.riskLevel)} · ${fmt.score(s.score100)}`),
  );
  // Node.append() would print "null", so the optional badge is added only when needed.
  if (!view.team) els.title.append(h("span", { class: "badge badge--dashed" }, t.noBhw));
  document.title = `${view.barangay.name} · AeDispatch`;
}

function renderBody() {
  clear(els.body);
  els.body.append(
    buildWhy(),
    h("div", { class: "decision" }, buildEvidence(), h("div", { class: "tiers" }, buildTier1(), buildTier2())),
    buildRecent(),
  );
}

async function refresh() {
  view = await get(`/api/officer/barangays/${id}/decision`);
  renderHeader();
  renderBody();
}

async function load() {
  try {
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    clear(els.body);
    // A barangay that does not exist will not appear on a second try, so no retry button for it.
    showState(els.body, "error", { message: err.message || t.loadError, onRetry: err instanceof ApiError && err.status === 404 ? null : load });
  }
}

const main = document.getElementById("main");
els.title = h("div", { class: "decision-title" });
els.banners = h("div", { class: "decision-banners" });
els.body = h("div", { class: "stack" }, h("span", { class: "skeleton", style: "width: 60%; height: 120px" }));
main.append(
  h("header", { class: "decision-head" }, h("a", { class: "btn btn--back", href: BACK.href }, icon("chevron"), BACK.label), els.title),
  els.banners,
  els.body,
);
await mountShell({ active: "queue" });

if (!Number.isInteger(id) || id < 1) {
  clear(els.body);
  showState(els.body, "empty", { message: t.missingId });
} else {
  load();
}
