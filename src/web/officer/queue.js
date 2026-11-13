// Priority queue: every barangay, ranked by threat score, with search, a risk filter and a
// sort menu. The order, the risk level, the action and the trend all come from the server;
// this page only filters, sorts for viewing, formats and draws.

import { ApiError, get } from "../shared/api.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { menu } from "../shared/menu.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";
import { actionCell, decisionHref, riskBadge, scoreCell, tier2Badge } from "./parts.js";

const t = strings.officer.queue;
const LEVELS = ["high", "elevated", "moderate", "low"];
const TREND_ORDER = { rising: 0, flat: 1, falling: 2 };

const state = { query: "", risk: "all", sort: "threat", ranking: null };

const els = {};

// Lowercase and without accents, so "banag" finds "Bañag".
const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The order the officer asked to look at. "Highest threat first" is the server's own
 * order (the ranking); the others only change how the same list is shown.
 */
function sorted(list) {
  const ranked = [...list];
  switch (state.sort) {
    case "threatLow":
      return ranked.reverse();
    case "rising":
      return ranked.sort((a, b) => TREND_ORDER[a.trend] - TREND_ORDER[b.trend]); // stable: ties keep the ranking
    case "name":
      return ranked.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    default:
      return ranked;
  }
}

// ---- layout (built once; only the data inside changes) -----------------------------

function buildQueue() {
  els.search = h("input", {
    class: "input search__input",
    type: "search",
    placeholder: t.search,
    "aria-label": t.searchLabel,
    autocomplete: "off",
    oninput: () => {
      state.query = els.search.value;
      if (state.ranking) renderRows();
    },
  });
  // One button for the risk filter (with a badge when it is active) and one for the order.
  els.filterMenu = menu({
    label: t.filterLabel,
    iconName: "filter",
    title: t.filterTitle,
    items: [{ value: "all", label: t.riskAll }],
    value: "all",
    clearLabel: t.filterClear,
    clearValue: "all",
    onChange: (value) => {
      state.risk = value;
      renderRows();
    },
  });
  els.sortMenu = menu({
    label: t.sortLabel,
    iconName: "sort",
    title: t.sortTitle,
    align: "right",
    value: "threat",
    items: [
      { value: "threat", label: t.sorts.threat, icon: "sortHigh" },
      { value: "threatLow", label: t.sorts.threatLow, icon: "sortLow" },
      { value: "rising", label: t.sorts.rising, icon: "up" },
      { value: "name", label: t.sorts.name, icon: "sortName" },
    ],
    onChange: (value) => {
      state.sort = value;
      renderRows();
    },
  });
  els.tbody = h("tbody", {}, ...Array.from({ length: 6 }, (_, i) => skeletonRow(i)));
  els.queueState = h("div");

  return h(
    "section",
    { class: "card", id: "queue", "aria-label": t.title },
    h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search"), els.search), els.filterMenu.root, els.sortMenu.root),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table table--cards" },
        h("caption", { class: "sr-only" }, t.caption),
        h("thead", {}, h("tr", {}, ...Object.values(t.columns).map((label) => h("th", { scope: "col" }, label)))),
        els.tbody,
      ),
    ),
    els.queueState,
  );
}

// ---- drawing ------------------------------------------------------------------------

// Grey blocks where the rows will be, so the layout does not jump when data arrives.
function skeletonRow(i) {
  return h("tr", { "aria-hidden": "true" }, h("td", { colspan: 4 }, h("span", { class: "skeleton", style: `width:${88 - i * 6}%` })));
}

function row(b) {
  return h(
    "tr",
    { class: b.tier2.unlocked ? "has-tier2" : null },
    h("th", { scope: "row", class: "c-name" }, h("a", { class: "row-link", href: decisionHref(b, "queue") }, b.name), tier2Badge(b)),
    h("td", { class: "c-score" }, scoreCell(b)),
    h("td", { class: "c-risk" }, riskBadge(b)),
    h("td", { class: "c-action" }, actionCell(b, "queue")),
  );
}

/** The filter menu lists each risk level with how many barangays are in it. */
function renderFilterItems() {
  const all = state.ranking.barangays;
  els.filterMenu.setItems([
    { value: "all", label: t.riskAll, count: all.length },
    ...LEVELS.map((level) => ({ value: level, label: fmt.riskLabel(level), dot: level, count: all.filter((b) => b.riskLevel === level).length })),
  ]);
}

function renderRows() {
  clear(els.tbody);
  const matches = state.ranking.barangays.filter(
    (b) => (state.risk === "all" || b.riskLevel === state.risk) && plain(b.name).includes(plain(state.query.trim())),
  );
  if (matches.length === 0) {
    els.tbody.append(
      h(
        "tr",
        {},
        h(
          "td",
          { colspan: 4, class: "empty" },
          t.noMatch,
          " ",
          h(
            "button",
            {
              class: "btn btn--link",
              type: "button",
              onclick: () => {
                state.query = "";
                state.risk = "all";
                els.search.value = "";
                els.filterMenu.setValue("all");
                renderRows();
              },
            },
            t.clearFilters,
          ),
        ),
      ),
    );
    return;
  }
  sorted(matches).forEach((b) => els.tbody.append(row(b)));
}

async function load() {
  try {
    state.ranking = await get("/api/officer/ranking");
    els.sub.textContent = t.asOf(fmt.dateTime(state.ranking.asOf));
    showState(els.queueState, "ready");
    renderFilterItems();
    renderRows();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    clear(els.tbody);
    showState(els.queueState, "error", { message: err.message || t.loadError, onRetry: load });
  }
}

els.sub = h("p", { class: "page-head__sub" }, t.sub);
document.getElementById("main").append(
  h("header", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title" }, t.title), els.sub)),
  buildQueue(),
);
await mountShell({ active: "queue" });
load();

// Fresh numbers when the person comes back to this tab.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
