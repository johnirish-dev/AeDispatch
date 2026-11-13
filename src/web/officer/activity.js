// Activity & dispatches. The home view shows the field assignments. Two buttons in the header
// replace the page content in place (no pop-ups): Findings (what the BHWs submitted) and Logs
// (decisions, imports and submissions). Findings go barangay by barangay; one barangay shows its
// inspections newest first, separated by day like a message thread; one household shows the paper
// survey form. The address (#findings, #findings/3, #finding/12, #logs) records where you are, so
// the browser's Back button works. Everything comes from the server; this page only groups,
// filters and formats what it sent.

import { ApiError, get } from "../shared/api.js";
import { announce, clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.activity;
const EVENTS_STEP = 10;
const dash = strings.common.none;

const state = { findings: null, capped: false, bhw: "", from: "", to: "", positiveOnly: false, house: "", events: [], eventsShown: EVENTS_STEP, municipality: new Map() };
const els = {};
let renderToken = 0;
/** Counts print jobs; a newer one (or leaving the barangay) cancels the one being prepared. */
let printToken = 0;
const PRINT_PARALLEL = 6;
/** The server's findings list stops here without saying so; the page warns when it is reached. */
const FINDINGS_CAP = 200;
/** A purok with more households than this starts closed in the feed. */
const OPEN_UP_TO = 12;

const sum = (list, key) => list.reduce((n, item) => n + item[key], 0);
const byHouse = (a, b) => String(a.houseNo ?? "").localeCompare(String(b.houseNo ?? ""), "en", { numeric: true });

/** "Wed 4 Nov 2026" from a plain date such as "2026-11-04" (no time zone involved). */
function dayLabel(text) {
  const [y, m, d] = String(text).split("-").map(Number);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(new Date(Date.UTC(y, m - 1, d))).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

// ---- where we are ------------------------------------------------------------------------------

function route() {
  const hash = location.hash.replace(/^#/, "");
  let m;
  if (hash === "logs") return { name: "logs" };
  if (hash === "findings") return { name: "findings" };
  if ((m = /^findings\/(\d+)$/.exec(hash))) return { name: "barangay", id: Number(m[1]) };
  if ((m = /^finding\/(\d+)$/.exec(hash))) return { name: "finding", id: Number(m[1]) };
  return { name: "home" };
}

const back = (href, label) => h("a", { class: "btn btn--sm back", href }, `‹ ${label}`);
const heading = (text, id) => h("h2", { id, tabindex: "-1" }, text);

// ---- data ------------------------------------------------------------------------------------

async function ensureFindings() {
  if (state.findings === null) {
    state.findings = await get("/api/officer/findings");
    state.capped = state.findings.length >= FINDINGS_CAP;
  }
  return state.findings;
}

const capNote = () => (state.capped ? h("div", { class: "banner banner--warn", role: "status" }, h("span", {}, t.capNote(FINDINGS_CAP))) : null);

function loading() {
  return h("p", { class: "empty", role: "status" }, strings.common.loading);
}

function failure(err, message, retry) {
  const box = h("div");
  showState(box, "error", { message: err.message || message, onRetry: retry });
  return box;
}

// ---- home: the field assignments ------------------------------------------------------------

async function renderHome(token) {
  const body = h("div", { style: "margin-top: var(--s-4)" }, loading());
  els.view.append(h("section", { class: "card", "aria-labelledby": "assign-title" }, heading(t.assignmentsTitle, "assign-title"), body));
  try {
    const list = await get("/api/officer/assignments");
    if (token !== renderToken) return;
    clear(body);
    if (list.length === 0) {
      body.append(h("p", { class: "empty" }, t.assignmentsEmpty));
      return;
    }
    body.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table table--activity" },
          h("caption", { class: "sr-only" }, t.assignmentsTitle),
          h("thead", {}, h("tr", {}, ...["barangay", "assignment", "households", "status"].map((k) => h("th", { scope: "col" }, t.columns[k])))),
          h(
            "tbody",
            {},
            ...list.map((a) => {
              const status = fmt.statusBadge(a.status);
              return h(
                "tr",
                {},
                h("th", { scope: "row", class: "c-name" }, a.barangayName),
                h("td", { class: "c-assign", "data-label": t.columns.assignment }, fmt.taskTypeLabel(a.type)),
                h("td", { class: "c-house", "data-label": t.columns.households }, a.households > 0 ? String(a.households) : dash),
                h("td", { class: "c-status" }, h("span", { class: status.className }, status.label)),
              );
            }),
          ),
        ),
      ),
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (token !== renderToken) return;
    clear(body);
    body.append(failure(err, t.assignmentsError, () => render()));
  }
}

// ---- findings: the list of barangays ----------------------------------------------------------

/** One entry per barangay that has findings: its households, containers and last inspection. */
function barangaySummaries(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.barangayId)) groups.set(f.barangayId, []);
    groups.get(f.barangayId).push(f);
  }
  return [...groups.entries()]
    .map(([id, list]) => {
      const latest = list.reduce((a, b) => (b.surveyDate > a.surveyDate ? b : a));
      return { id, name: latest.barangayName, households: list.length, positive: sum(list, "positive"), containers: sum(list, "containers"), lastDate: latest.surveyDate };
    })
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.name.localeCompare(b.name)));
}

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The households as a file (UTF-8 with a mark so a spreadsheet reads the ñ in Peñafrancia). */
function exportCsv(rows) {
  const lines = [t.csvHeader, ...rows.map((f) => [f.barangayName, f.purokName, f.houseNo, f.surveyDate, f.bhwName, f.positive, f.containers].map(csvCell).join(","))];
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = h("a", { href: url, download: t.csvName });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  announce(t.exported(rows.length));
}

async function renderFindings(token) {
  const body = h("div", { style: "margin-top: var(--s-4)" }, loading());
  const exportBtn = h("button", { class: "btn", type: "button", disabled: true }, t.export);
  els.view.append(back("#", t.backToActivity), h("section", { class: "card", "aria-labelledby": "findings-title" }, h("div", { class: "card__head" }, heading(t.findingsTitle, "findings-title"), exportBtn), body));
  try {
    const findings = await ensureFindings();
    if (token !== renderToken) return;
    clear(body);
    const rows = barangaySummaries(findings);
    if (rows.length === 0) {
      body.append(h("p", { class: "empty" }, t.findingsEmpty));
      return;
    }
    exportBtn.disabled = false;
    exportBtn.onclick = () => exportCsv(findings);
    if (state.capped) body.append(capNote());
    body.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table table--barangays" },
          h("caption", { class: "sr-only" }, t.findingsTitle),
          h("thead", {}, h("tr", {}, ...["barangay", "last", "households", "positive"].map((k) => h("th", { scope: "col" }, t.columns[k])), h("th", { scope: "col" }, h("span", { class: "sr-only" }, t.columns.open)))),
          h(
            "tbody",
            {},
            ...rows.map((b) =>
              h(
                "tr",
                {},
                h("th", { scope: "row", class: "c-name" }, b.name),
                h("td", { class: "c-date", "data-label": t.columns.last }, fmt.plainDate(b.lastDate)),
                h("td", { class: "c-house", "data-label": t.columns.households }, String(b.households)),
                h("td", { class: "c-pos", "data-label": t.columns.positive }, t.positiveOf(b.positive, b.containers)),
                h("td", { class: "c-open" }, h("a", { class: "btn btn--sm", href: `#findings/${b.id}`, "aria-label": t.openBarangayLabel(b.name) }, t.open)),
              ),
            ),
          ),
        ),
      ),
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (token !== renderToken) return;
    clear(body);
    body.append(failure(err, t.findingsError, () => render()));
  }
}

// ---- findings: one barangay, newest day first ---------------------------------------------------

/** Days newest first; under each day the puroks inspected, each with its households. */
function feedGroups(list) {
  const days = new Map();
  for (const f of list) {
    if (!days.has(f.surveyDate)) days.set(f.surveyDate, new Map());
    const key = `${f.purokId}:${f.bhwId}`;
    const inspections = days.get(f.surveyDate);
    if (!inspections.has(key)) inspections.set(key, { purok: f.purokName, bhw: f.bhwName, households: [] });
    inspections.get(key).households.push(f);
  }
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, inspections]) => ({
      date,
      inspections: [...inspections.values()].map((i) => ({ ...i, households: i.households.sort(byHouse) })).sort((a, b) => String(a.purok).localeCompare(String(b.purok), "en", { numeric: true })),
    }));
}

function householdLink(f) {
  return h(
    "a",
    { class: "house", href: `#finding/${f.id}`, "aria-label": t.openLabel(f.barangayName, f.houseNo) },
    h("span", { class: "house__no" }, t.houseNo(f.houseNo ?? dash)),
    h("span", { class: `house__pos${f.positive > 0 ? " is-positive" : ""}` }, t.positiveOf(f.positive, f.containers)),
  );
}

const percent = (n, d) => (d === 0 ? dash : `${((n / d) * 100).toFixed(1)}%`);

/** The three standard survey indices for a set of household records. */
function indices(rows) {
  const households = rows.length;
  const containers = sum(rows, "containers");
  const positive = sum(rows, "positive");
  const positiveHouses = rows.filter((f) => f.positive > 0).length;
  return {
    households,
    containers,
    positive,
    house: percent(positiveHouses, households),
    container: percent(positive, containers),
    breteau: households === 0 ? dash : ((positive / households) * 100).toFixed(1),
    breteauValue: households === 0 ? -1 : positive / households,
  };
}

function summaryStrip(rows) {
  const x = indices(rows);
  const cell = (label, value) => h("div", { class: "idx" }, h("dt", {}, label), h("dd", {}, value));
  return h("div", {}, h("dl", { class: "idx-list" }, cell(t.summary.households, String(x.households)), cell(t.summary.house, x.house), cell(t.summary.container, x.container), cell(t.summary.breteau, x.breteau)), h("p", { class: "muted idx-help" }, t.summary.help));
}

function purokTable(rows) {
  const groups = new Map();
  for (const f of rows) {
    const key = f.purokName ?? dash;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const list = [...groups.entries()].map(([name, items]) => ({ name, ...indices(items) })).sort((a, b) => b.breteauValue - a.breteauValue || a.name.localeCompare(b.name, "en", { numeric: true }));
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table table--puroks" },
      h("caption", { class: "table__caption" }, t.puroks.title, h("span", { class: "muted" }, ` · ${t.puroks.note}`)),
      h("thead", {}, h("tr", {}, ...["purok", "households", "containers", "positive", "house", "container", "breteau"].map((k) => h("th", { scope: "col", class: k === "purok" ? null : "num" }, t.puroks.columns[k])))),
      h("tbody", {}, ...list.map((p) => h("tr", {}, h("th", { scope: "row" }, p.name), h("td", { class: "num" }, String(p.households)), h("td", { class: "num" }, String(p.containers)), h("td", { class: "num" }, String(p.positive)), h("td", { class: "num" }, p.house), h("td", { class: "num" }, p.container), h("td", { class: "num" }, p.breteau)))),
    ),
  );
}

/** One printed page in front of a batch: what the batch is, the figures, and the purok table. */
function coverPage(name, rows, scope) {
  const x = indices(rows);
  const cell = (label, value) => h("div", { class: "idx" }, h("dt", {}, label), h("dd", {}, value));
  return h(
    "article",
    { class: "paper cover" },
    h("p", { class: "pf-formno" }, t.cover.prepared(fmt.dateTime(new Date().toISOString()))),
    h("div", { class: "pf-title" }, h("p", {}, t.cover.program), h("h2", {}, t.cover.title(name))),
    h("p", { class: "cover__scope" }, scope),
    h("dl", { class: "idx-list" }, cell(t.summary.households, String(x.households)), cell(t.summary.house, x.house), cell(t.summary.container, x.container), cell(t.summary.breteau, x.breteau)),
    h("p", { class: "muted idx-help" }, t.summary.help),
    purokTable(rows),
    h("p", { class: "cover__forms" }, t.cover.forms(rows.length)),
  );
}

/** The households in the order the feed shows them, so the printed pages follow the screen. */
const feedOrder = (rows) => feedGroups(rows).flatMap((day) => day.inspections.flatMap((i) => i.households));

/**
 * Prints one form per page for the given households. The forms are fetched a few at a time,
 * built into a hidden area, printed, and removed again, so nothing stays in memory afterwards.
 */
async function printForms(rows, progress, cover) {
  const token = ++printToken;
  const list = feedOrder(rows);
  const details = new Array(list.length);
  let next = 0;
  let done = 0;
  let failed = 0;
  progress(0, list.length);
  async function worker() {
    while (next < list.length && token === printToken) {
      const i = next++;
      try {
        details[i] = await get(`/api/officer/findings/${list[i].id}`);
      } catch {
        failed++;
      }
      done++;
      if (token === printToken) progress(done, list.length);
    }
  }
  await Promise.all(Array.from({ length: PRINT_PARALLEL }, worker));
  await els.municipalityReady;
  if (token !== printToken) return { cancelled: true };
  if (failed > 0) return { failed };
  clearPrintArea();
  els.printArea = h("div", { class: "print-only", "aria-hidden": "true" }, ...[cover, ...details.map((f) => formArticle(f))].map((page) => h("div", { class: "print-form" }, page)));
  document.body.append(els.printArea);
  document.body.classList.add("is-printing-batch");
  window.addEventListener("afterprint", clearPrintArea, { once: true });
  window.print();
  return { printed: list.length };
}

function clearPrintArea() {
  els.printArea?.remove();
  els.printArea = null;
  document.body.classList.remove("is-printing-batch");
}

async function renderBarangay(id, token) {
  state.bhw = state.from = state.to = state.house = "";
  state.positiveOnly = false;
  const body = h("div", { style: "margin-top: var(--s-4)" }, loading());
  const title = h("div", { class: "card__head" }, heading("", "findings-title"));
  const exportBtn = h("button", { class: "btn", type: "button", disabled: true }, t.export);
  els.view.append(back("#findings", t.backToBarangays), h("section", { class: "card", "aria-labelledby": "findings-title" }, title, body));
  try {
    const all = await ensureFindings();
    if (token !== renderToken) return;
    const rows = all.filter((f) => f.barangayId === id);
    clear(body);
    if (rows.length === 0) {
      body.append(h("p", { class: "empty" }, t.barangayNone));
      return;
    }
    title.querySelector("h2").textContent = rows[0].barangayName;
    title.append(exportBtn);

    const bhws = [...new Map(rows.map((f) => [String(f.bhwId), f.bhwName ?? dash])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const bhwSel = h("select", { class: "select", id: "f-bhw", onchange: () => { state.bhw = bhwSel.value; update(); } }, h("option", { value: "" }, t.filters.bhwAll), ...bhws.map(([v, label]) => h("option", { value: v }, label)));
    const fromIn = h("input", { class: "input", type: "date", id: "f-from", onchange: () => { state.from = fromIn.value; update(); } });
    const toIn = h("input", { class: "input", type: "date", id: "f-to", onchange: () => { state.to = toIn.value; update(); } });
    const clearBtn = h("button", { class: "btn btn--link", type: "button", hidden: true, onclick: () => {
      state.bhw = state.from = state.to = state.house = "";
      state.positiveOnly = false;
      bhwSel.value = fromIn.value = toIn.value = houseIn.value = "";
      positiveIn.checked = false;
      update();
    } }, t.filters.clear);
    const positiveIn = h("input", { type: "checkbox", onchange: () => { state.positiveOnly = positiveIn.checked; update(); } });
    const houseIn = h("input", { class: "input", type: "search", id: "f-house", autocomplete: "off", oninput: () => { state.house = houseIn.value; update(); } });
    const totals = h("p", { class: "muted", role: "status" });
    const summary = h("div");
    const puroks = h("div");
    const feed = h("div", { class: "feed" });
    const printBtn = h("button", { class: "btn", type: "button", onclick: askPrint }, icon("file"));
    const printBar = h("div", { class: "print-bar", hidden: true });
    const lab = (text, forId, control) => h("div", { class: "field" }, h("label", { class: "field__label", for: forId }, text), control);

    let scope = rows; // the date and BHW filters: what the figures are about
    let shown = rows; // scope, plus "positive only" and the house search: what the feed, the export and the print use

    /** The filters in words, for the cover page. */
    function scopeText() {
      const parts = [];
      if (state.from !== "" || state.to !== "") parts.push(t.cover.dates(state.from, state.to));
      if (state.bhw !== "") parts.push(t.cover.bhw(bhws.find(([v]) => v === state.bhw)?.[1] ?? dash));
      if (state.positiveOnly) parts.push(t.cover.positiveOnly);
      if (state.house.trim() !== "") parts.push(t.cover.house(state.house.trim()));
      return parts.length > 0 ? parts.join(" · ") : t.cover.all;
    }

    function closePrintBar() {
      printToken++;
      printBar.hidden = true;
      clear(printBar);
    }

    function askPrint() {
      clear(printBar);
      printBar.hidden = false;
      const go = h("button", { class: "btn btn--primary btn--sm", type: "button", onclick: start }, t.print.go);
      const cancel = h("button", { class: "btn btn--sm", type: "button", onclick: () => { closePrintBar(); printBtn.focus(); } }, t.print.cancel);
      printBar.append(h("p", {}, t.print.confirm(shown.length)), h("div", { class: "import__actions" }, go, cancel));
      go.focus();
    }

    async function start() {
      clear(printBar);
      const status = h("p", { role: "status" }, t.print.preparing(0, shown.length));
      const cancel = h("button", { class: "btn btn--sm", type: "button", onclick: () => { closePrintBar(); printBtn.focus(); } }, t.print.cancel);
      printBar.append(status, h("div", { class: "import__actions" }, cancel));
      const result = await printForms(shown, (done, total) => { status.textContent = t.print.preparing(done, total); }, coverPage(rows[0].barangayName, shown, scopeText()));
      if (result.cancelled) return;
      if (result.failed) {
        clear(printBar);
        printBar.append(h("p", { class: "field__error", role: "alert", style: "display:block" }, t.print.failed(result.failed)), h("div", { class: "import__actions" }, h("button", { class: "btn btn--sm", type: "button", onclick: askPrint }, t.print.retry), h("button", { class: "btn btn--sm", type: "button", onclick: closePrintBar }, t.print.cancel)));
        return;
      }
      closePrintBar();
      announce(t.print.done(result.printed));
    }

    function update() {
      closePrintBar();
      clear(feed);
      scope = rows.filter((f) => (state.bhw === "" || String(f.bhwId) === state.bhw) && (state.from === "" || f.surveyDate >= state.from) && (state.to === "" || f.surveyDate <= state.to));
      const needle = state.house.trim().toLowerCase();
      shown = scope.filter((f) => (!state.positiveOnly || f.positive > 0) && (needle === "" || String(f.houseNo ?? "").toLowerCase().includes(needle)));
      clear(summary);
      summary.append(summaryStrip(scope));
      clear(puroks);
      if (scope.length > 0) puroks.append(purokTable(scope));
      exportBtn.disabled = shown.length === 0;
      printBtn.disabled = shown.length === 0;
      printBtn.replaceChildren(icon("file"), t.print.button(shown.length));
      clearBtn.hidden = state.bhw === "" && state.from === "" && state.to === "" && state.house === "" && !state.positiveOnly;
      totals.textContent = t.totals(shown.length, sum(shown, "positive"), sum(shown, "containers"));
      if (shown.length === 0) {
        feed.append(h("p", { class: "empty" }, t.findingsNoMatch));
        return;
      }
      feedGroups(shown).forEach((day) => {
        feed.append(
          h(
            "section",
            { class: "day", "aria-label": dayLabel(day.date) },
            h("h3", { class: "day__label" }, h("span", {}, dayLabel(day.date))),
            ...day.inspections.map((i) =>
              h(
                "details",
                { class: "inspection", open: i.households.length <= OPEN_UP_TO },
                h("summary", { class: "inspection__head" }, h("strong", {}, i.purok ?? dash), h("span", { class: "muted" }, `${i.bhw ?? dash} · ${t.households(i.households.length)} · ${t.positiveOf(sum(i.households, "positive"), sum(i.households, "containers"))} ${t.positiveWord}`)),
                h("div", { class: "houses" }, ...i.households.map(householdLink)),
              ),
            ),
          ),
        );
      });
    }

    exportBtn.onclick = () => exportCsv(shown);
    if (state.capped) body.append(capNote());
    body.append(
      h("div", { class: "filters filters--three" }, lab(t.filters.from, "f-from", fromIn), lab(t.filters.to, "f-to", toIn), lab(t.filters.bhw, "f-bhw", bhwSel)),
      summary,
      puroks,
      h("div", { class: "feed__bar" }, h("h3", { class: "feed__title" }, t.feedTitle), h("div", { class: "feed__toggles" }, h("button", { class: "btn btn--sm", type: "button", onclick: () => feed.querySelectorAll("details").forEach((d) => (d.open = true)) }, t.expandAll), h("button", { class: "btn btn--sm", type: "button", onclick: () => feed.querySelectorAll("details").forEach((d) => (d.open = false)) }, t.collapseAll))),
      h("div", { class: "feed-controls" }, h("label", { class: "check" }, positiveIn, h("span", {}, t.positiveOnly)), lab(t.houseSearch, "f-house", houseIn), printBtn),
      printBar,
      h("div", { class: "filters__foot" }, totals, clearBtn),
      feed,
    );
    update();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (token !== renderToken) return;
    clear(body);
    body.append(failure(err, t.findingsError, () => render()));
  }
}

// ---- findings: one household, laid out like the paper form ---------------------------------------

const val = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

/** A label followed by a line with the value written on it, like the paper form. */
function line(label, value, extra = "") {
  return h("div", { class: `pf-line ${extra}` }, h("span", { class: "pf-label" }, label), h("span", { class: "pf-value" }, val(value)));
}

/** "____ Concrete": a line that holds a check mark, then its word. */
function check(label, on) {
  return h("div", { class: "pf-check" }, h("span", { class: "pf-tick", "aria-hidden": "true" }, on ? "✓" : ""), h("span", {}, label, on ? h("span", { class: "sr-only" }, " (checked)") : null));
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

function structureChecks(f) {
  const s = norm(f.buildingStructure);
  const matched = { concrete: s === "concrete", semi: s === "semiconcrete", light: s.includes("wood") || s.includes("light"), shanty: s.includes("shanty") };
  const known = matched.concrete || matched.semi || matched.light || matched.shanty;
  return { matched, other: known || s === "" ? null : f.buildingStructure };
}

/** One row's figures added up, or null when nothing was recorded for it. */
function addUp(items) {
  if (items.length === 0) return null;
  const add = (key) => items.reduce((n, c) => n + c[key], 0);
  return { withCover: add("withCover"), withoutCover: add("withoutCover"), total: add("total"), positive: add("positive"), larvae: add("larvaeCount"), pupae: add("pupaeCount") };
}

/**
 * The rows of one part of the form (indoor, outdoor or natural): the printed container names in
 * order, then "Others, specify" with the names the BHW wrote. Nothing is dropped: if more names
 * were written than the form has lines, the extra lines are added.
 */
function sectionRows(containers, location, names, otherLabel, otherLines) {
  const mine = containers.filter((c) => c.location === location);
  const slot = new Map(names.map((n, i) => [norm(n), i]));
  const named = names.map(() => []);
  const other = new Map();
  for (const c of mine) {
    const i = slot.get(norm(c.containerType));
    if (i !== undefined) named[i].push(c);
    else {
      if (!other.has(c.containerType)) other.set(c.containerType, []);
      other.get(c.containerType).push(c);
    }
  }
  const rows = names.map((name, i) => ({ no: `${i + 1}.`, label: name, data: addUp(named[i]) }));
  rows.push({ no: `${names.length + 1}.`, label: otherLabel, data: null });
  const written = [...other.entries()];
  const lines = Math.max(otherLines, written.length);
  for (let k = 0; k < lines; k++) {
    rows.push({ no: `${names.length + 1}${String.fromCharCode(97 + k)}.`, label: written[k]?.[0] ?? "", data: written[k] ? addUp(written[k][1]) : null, written: Boolean(written[k]) });
  }
  return rows;
}

function paperTable(f) {
  const p = t.paper;
  const sections = [
    { title: p.indoor, rows: sectionRows(f.containers, "indoor", p.indoorNames, p.othersIndoor, 2), cover: true },
    { title: p.outdoor, rows: sectionRows(f.containers, "outdoor", p.outdoorNames, p.othersOutdoor, 4), cover: true },
    { title: p.natural, rows: sectionRows(f.containers, "natural", p.naturalNames, p.othersNatural, 3), cover: false },
  ];
  // Like the paper form, a zero is left blank; only the totals show it.
  const cell = (n, shaded = false, keepZero = false) => h("td", { class: `pf-n${shaded ? " pf-shade" : ""}` }, n === undefined || n === null || (n === 0 && !keepZero) ? "" : String(n));
  const body = [];
  for (const s of sections) {
    body.push(h("tr", { class: "pf-section" }, h("th", { colspan: 7, scope: "colgroup" }, s.title)));
    for (const r of s.rows) {
      const d = r.data;
      body.push(
        h(
          "tr",
          {},
          h("th", { scope: "row", class: `pf-name${r.written ? " is-written" : ""}` }, h("span", { class: "pf-no" }, r.no), r.label),
          cell(d?.withCover, !s.cover),
          cell(d?.withoutCover, !s.cover),
          cell(d?.total, false, true),
          cell(d?.positive),
          cell(d?.larvae),
          cell(d?.pupae),
        ),
      );
    }
  }
  const all = addUp(f.containers);
  body.push(h("tr", { class: "pf-total" }, h("th", { scope: "row", class: "pf-name" }, p.total), cell(all?.withCover, false, true), cell(all?.withoutCover, false, true), cell(all?.total, false, true), cell(all?.positive, false, true), cell(all?.larvae, false, true), cell(all?.pupae, false, true)));
  const h1 = p.head1;
  return h(
    "table",
    { class: "pf-table" },
    h("caption", { class: "sr-only" }, p.containers),
    h(
      "thead",
      {},
      h("tr", {}, h("th", { rowspan: 2, scope: "col", class: "pf-corner" }), h("th", { colspan: 2, scope: "colgroup" }, h1.number), h("th", { rowspan: 2, scope: "col" }, h1.total), h("th", { rowspan: 2, scope: "col" }, h1.positive), h("th", { colspan: 2, scope: "colgroup" }, h1.results)),
      h("tr", {}, h("th", { scope: "col" }, h1.withCover), h("th", { scope: "col" }, h1.withoutCover), h("th", { scope: "col" }, h1.larvae), h("th", { scope: "col" }, h1.pupae)),
    ),
    h("tbody", {}, ...body),
  );
}

/** One household's survey, laid out like the paper "Dengue Form - 5" (the same on screen, in the PDF and in a batch print). */
function formArticle(f) {
  const p = t.paper;
  const { matched, other } = structureChecks(f);
  return h(
    "article",
    { class: "paper", "aria-labelledby": `finding-title-${f.id}` },
    h("p", { class: "pf-formno" }, p.formNo),
    h("div", { class: "pf-title" }, h("p", {}, p.program), h("h2", { id: `finding-title-${f.id}`, tabindex: "-1" }, p.title), h("p", {}, p.subtitle)),
    h(
      "div",
      { class: "pf-head" },
      line(p.houseNo, f.houseNo),
      line(p.school, ""),
      line(p.municipality, state.municipality.get(f.barangayId)),
      h("div"),
      line(p.head, f.headOfFamily),
      line(p.purok, f.purokName),
      h("div", { class: "pf-trio" }, line(p.age, f.age), line(p.sex, f.sex), line(p.status, f.civilStatus)),
      h("div"),
      line(p.occupation, f.occupation),
      line(p.barangay, f.barangayName),
      line(p.persons, f.personsSlept, "pf-wide"),
    ),
    h(
      "div",
      { class: "pf-structure" },
      h("p", { class: "pf-subhead" }, p.building),
      h(
        "div",
        { class: "pf-checks" },
        h("div", {}, check(p.concrete, matched.concrete), check(p.semiConcrete, matched.semi), check(p.light, matched.light)),
        h("div", {}, check(p.shanty, matched.shanty), check(p.singleStorey, f.storeys === 1), check(p.multiStorey, f.storeys !== null && f.storeys >= 2)),
        h("div", {}, h("div", { class: "pf-rooms" }, h("span", { class: "pf-tick" }, val(f.rooms)), h("span", {}, p.rooms)), check(p.screened, f.screened === true), check(p.unscreened, f.screened === false)),
      ),
      other ? h("p", { class: "pf-other" }, other) : null,
    ),
    h("p", { class: "pf-subhead" }, p.containers),
    f.noContainersFound ? h("p", { class: "pf-none" }, p.noContainers) : null,
    paperTable(f),
    h("div", { class: "pf-foot" }, line(p.surveyedBy, f.surveyedBy), line(p.date, f.surveyDate ? fmt.plainDate(f.surveyDate) : "")),
    h("p", { class: "pf-submitted" }, p.submitted(fmt.dateTime(f.submittedAt))),
  );
}

async function renderFinding(id, token) {
  const slot = h("div", {}, loading());
  els.view.append(slot);
  try {
    const [f] = await Promise.all([get(`/api/officer/findings/${id}`), els.municipalityReady]);
    if (token !== renderToken) return;
    clear(slot);
    slot.append(h("div", { class: "view-bar no-print" }, back(`#findings/${f.barangayId}`, t.backToBarangay(f.barangayName)), h("button", { class: "btn btn--primary", type: "button", onclick: () => window.print() }, icon("file"), t.print.single)), h("div", { class: "pf-scroll" }, formArticle(f)));
    focusHeading();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (token !== renderToken) return;
    clear(slot);
    slot.append(back("#findings", t.backToBarangays), failure(err, t.findingError, () => render()));
  }
}

// ---- logs ------------------------------------------------------------------------------------

async function renderLogs(token) {
  state.eventsShown = EVENTS_STEP;
  const body = h("div", { style: "margin-top: var(--s-4)" }, loading());
  els.view.append(back("#", t.backToActivity), h("section", { class: "card", "aria-labelledby": "logs-title" }, heading(t.logsTitle, "logs-title"), h("p", { class: "card__sub" }, t.logsSub), body));
  try {
    state.events = await get("/api/officer/events?limit=50");
    if (token !== renderToken) return;
    const timeline = h("ul", { class: "timeline" });
    const more = h("button", { class: "btn btn--sm", type: "button", hidden: true, onclick: () => { state.eventsShown += EVENTS_STEP; draw(); } });
    function draw() {
      clear(timeline);
      if (state.events.length === 0) timeline.append(h("li", { class: "muted" }, t.eventsEmpty));
      state.events.slice(0, state.eventsShown).forEach((e) => timeline.append(h("li", { class: "timeline__item" }, h("span", { class: "timeline__time" }, fmt.dateTime(e.at)), h("span", {}, e.text))));
      const left = state.events.length - state.eventsShown;
      more.hidden = left <= 0;
      more.textContent = t.eventsMore(Math.min(EVENTS_STEP, Math.max(left, 0)));
    }
    clear(body);
    body.append(timeline, h("div", { class: "import__actions" }, more));
    draw();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (token !== renderToken) return;
    clear(body);
    body.append(failure(err, t.eventsError, () => render()));
  }
}

// ---- the page ------------------------------------------------------------------------------

function focusHeading() {
  const target = els.view.querySelector("h2[tabindex]");
  target?.focus({ preventScroll: true });
}

function render(first = false) {
  const r = route();
  const token = ++renderToken;
  printToken++;
  clearPrintArea();
  clear(els.view);
  els.findingsLink.setAttribute("aria-current", r.name === "findings" || r.name === "barangay" || r.name === "finding" ? "page" : "false");
  els.logsLink.setAttribute("aria-current", r.name === "logs" ? "page" : "false");
  if (!first) window.scrollTo(0, 0);
  switch (r.name) {
    case "findings":
      renderFindings(token);
      break;
    case "barangay":
      renderBarangay(r.id, token);
      break;
    case "finding":
      renderFinding(r.id, token);
      break;
    case "logs":
      renderLogs(token);
      break;
    default:
      renderHome(token);
  }
  if (!first && r.name !== "finding") focusHeading();
}

function build() {
  els.findingsLink = h("a", { class: "btn", href: "#findings" }, icon("clipboard"), t.findingsButton);
  els.logsLink = h("a", { class: "btn", href: "#logs" }, icon("activity"), t.logs);
  els.view = h("div", { class: "stack" });
  return [
    h("header", { class: "page-head no-print" }, h("div", {}, h("h1", { class: "page-title" }, t.title), h("p", { class: "page-head__sub" }, t.sub)), h("div", { class: "page-head__actions" }, els.findingsLink, els.logsLink)),
    els.view,
  ];
}

document.getElementById("main").append(...build());
await mountShell({ active: "activity" });
// The municipality is on the barangay, not on the survey record.
els.municipalityReady = get("/api/officer/barangays")
  .then((list) => list.forEach((b) => state.municipality.set(b.id, b.municipality)))
  .catch(() => {});
window.addEventListener("hashchange", () => render());
render(true);
