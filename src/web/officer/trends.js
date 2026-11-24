// Trends: week by week for the past eight weeks. One chart at a time: the confirmed cases, how many barangays sit at
// each risk level, and one figure for each of the other data sources. The numbers come from /api/officer/trends.

import { ApiError, get } from "../shared/api.js";
import { lineChart } from "../shared/chart.js";
import { compareChart } from "../shared/compare-chart.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.trends;
const TABS = ["risk", "cases", "weather", "resident", "containers"];
const state = { tab: "risk", trends: null };
const tabButtons = new Map();
const body = h("div", { class: "trends-body" }, h("span", { class: "skeleton chart-skeleton" }));

try {
  const saved = sessionStorage.getItem("trendsTab");
  if (saved && TABS.includes(saved)) state.tab = saved;
} catch {
  /* the tab is only a convenience */
}

function view(title, chart) {
  return h("section", { class: "card", role: "tabpanel", "aria-labelledby": `tab-${state.tab}` }, h("h2", {}, title), chart);
}

function draw() {
  const trends = state.trends;
  if (!trends) return;
  const partial = trends.latestWeekPartial === true;
  const labels = trends.weeks.map(fmt.weekShort);
  const many = (series, chartTitle, desc) => compareChart({ labels, partialLast: partial, title: chartTitle, desc, series });
  const one = (item, chartTitle, desc) => lineChart({ labels, partialLast: partial, title: chartTitle, desc, series: [item], fill: true });
  const sig = trends.signals;
  const names = t.signals;

  let card;
  if (state.tab === "cases") {
    card = view(t.casesTitle, one({ name: t.casesSeries, color: "var(--brand)", values: trends.casesPerWeek }, t.casesChartTitle, t.casesChartDesc));
  } else if (state.tab === "risk") {
    const count = (level) => trends.riskPerWeek.map((week) => week[level]);
    card = view(
      t.riskTitle,
      many(
        [
          { name: fmt.riskLabel("high"), color: "var(--high-fill)", values: count("high") },
          { name: fmt.riskLabel("elevated"), color: "var(--elev-fill)", values: count("elevated") },
          { name: fmt.riskLabel("moderate"), color: "var(--mod-fill)", values: count("moderate") },
          { name: fmt.riskLabel("low"), color: "var(--low-fill)", values: count("low") },
        ],
        t.riskChartTitle,
        t.riskChartDesc,
      ),
    );
  } else if (state.tab === "weather") {
    card = view(
      t.weatherTitle,
      many(
        [
          { ...names.rain, color: "#2b6cb0", values: sig.rainMm },
          { ...names.temp, color: "#c05621", values: sig.meanTempC, axis: "right", zeroBased: false },
        ],
        t.weatherChartTitle,
        t.weatherChartDesc,
      ),
    );
  } else if (state.tab === "resident") {
    card = view(
      t.residentTitle,
      many(
        [
          { ...names.reports, color: "var(--brand)", values: sig.householdReports },
          { ...names.symptoms, color: "#6b46c1", values: sig.symptomWarnings },
        ],
        t.residentChartTitle,
        t.residentChartDesc,
      ),
    );
  } else {
    const info = names.containers;
    card = view(info.name, one({ ...info, color: "var(--brand)", values: sig.containersPositivePct }, `${info.name}: ${t.signalChartTitle}`, t.signalChartDesc));
  }
  clear(body).append(card);
}

function showTab(key, focus = false) {
  state.tab = key;
  try {
    sessionStorage.setItem("trendsTab", key);
  } catch {
    /* no storage: the tab is not remembered */
  }
  for (const [k, button] of tabButtons) {
    button.setAttribute("aria-selected", String(k === key));
    button.tabIndex = k === key ? 0 : -1;
  }
  if (focus) tabButtons.get(key).focus();
  draw();
}

const tabBar = h("div", { class: "tabs", role: "tablist", "aria-label": t.tabsLabel });
TABS.forEach((key, i) => {
  const button = h(
    "button",
    {
      class: "tab",
      type: "button",
      role: "tab",
      id: `tab-${key}`,
      onclick: () => showTab(key),
      onkeydown: (event) => {
        const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (move) showTab(TABS[(i + move + TABS.length) % TABS.length], true);
      },
    },
    t.tabs[key],
  );
  tabButtons.set(key, button);
  tabBar.append(button);
});

async function load() {
  try {
    state.trends = await get("/api/officer/trends");
    draw();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showState(body, "error", { message: err.message || t.loadError, onRetry: load });
  }
}

document.getElementById("main").classList.add("main--chart");
document.getElementById("main").append(h("header", { class: "page-head" }, h("h1", { class: "page-title" }, t.title)), tabBar, body);
await mountShell({ active: "trends" });
showTab(state.tab);
load();
